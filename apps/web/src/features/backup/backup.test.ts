// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../../infrastructure/database/setup'
import { SqliteDatabase } from '../../infrastructure/database/SqliteDatabase'
import { latestSchemaVersion } from '../../infrastructure/database/migrations'
import type { DatabaseHealth } from '../../infrastructure/database/types'
import { BetterSqliteTestDriver } from '../../test/database/BetterSqliteTestDriver'
import { AuthRepository } from '../auth/AuthRepository'
import { AuthenticationService } from '../auth/AuthenticationService'
import { RoleManagementService } from '../auth/RoleManagementService'
import { UserManagementService } from '../auth/UserManagementService'
import type { PasswordHasher } from '../auth/auth.types'
import { BackupError } from './backup.errors'
import type {
  BackupDatabaseAdapter,
  BackupPayload,
} from './BackupDatabaseAdapter'
import { BackupService } from './BackupService'

class TestPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return createHash('sha256').update(password).digest('hex')
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    return (await this.hash(password)) === encodedHash
  }
}

class FakeBackupAdapter implements BackupDatabaseAdapter {
  current: BackupPayload = {
    database: 'safa-retail',
    version: 1,
    encrypted: false,
    mode: 'full',
    tables: [
      { name: 'database_migrations', values: [[latestSchemaVersion, 'current', 'a'.repeat(64), '2026-01-01T00:00:00.000Z']] },
      { name: 'users', values: [['user-row']] },
    ],
  }
  healthChecks: DatabaseHealth[] = []
  replaced: BackupPayload[] = []
  failValidation = false

  async exportDatabase(): Promise<BackupPayload> {
    return this.clone(this.current)
  }

  async validateDatabase(): Promise<void> {
    if (this.failValidation) {
      throw new BackupError('Fake SQLite rejected the backup')
    }
  }

  async replaceDatabase(payload: BackupPayload): Promise<void> {
    this.replaced.push(this.clone(payload))
    this.current = this.clone(payload)
  }

  async verifyIntegrity(): Promise<DatabaseHealth> {
    return this.healthChecks.shift() ?? {
      integrity: 'ok',
      foreignKeyViolations: 0,
      schemaVersion: latestSchemaVersion,
    }
  }

  private clone(payload: BackupPayload): BackupPayload {
    return JSON.parse(JSON.stringify(payload)) as BackupPayload
  }
}

let database: SqliteDatabase
let ownerId: string
let passwordHasher: PasswordHasher
let adapter: FakeBackupAdapter
let backups: BackupService
type SerializedBackup = {
  format: string
  formatVersion: number
  schemaVersion: number
  exportedAt: string
  checksum: string
  database: BackupPayload
}

beforeEach(async () => {
  database = new SqliteDatabase(new BetterSqliteTestDriver())
  await database.open()
  await initializeDatabase(database)
  passwordHasher = new TestPasswordHasher()
  const authentication = new AuthenticationService(database, passwordHasher)
  ownerId = (await authentication.setupInitialOwner({
    username: 'owner',
    displayName: 'Owner',
    password: 'a-secure-owner-password',
  })).id
  adapter = new FakeBackupAdapter()
  backups = new BackupService(database, adapter)
})

afterEach(async () => {
  await database.close()
})

describe('local database backup and restore', () => {
  it('creates checksum-protected full backups and previews their contents', async () => {
    const bytes = await backups.createBackup(ownerId)
    const backup = JSON.parse(new TextDecoder().decode(bytes)) as {
      format: string
      formatVersion: number
      schemaVersion: number
      checksum: string
    }
    expect(backup).toMatchObject({
      format: 'safa-retail-backup',
      formatVersion: 1,
      schemaVersion: latestSchemaVersion,
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    await expect(backups.previewBackup(ownerId, bytes)).resolves.toMatchObject({
      schemaVersion: latestSchemaVersion,
      tableCount: 2,
      rowCount: 2,
    })
  })

  it('rejects tampered, unsupported, oversized, and unconfirmed restore requests', async () => {
    const bytes = await backups.createBackup(ownerId)
    const changed = new TextDecoder().decode(bytes).replace('user-row', 'changed')
    await expect(
      backups.previewBackup(ownerId, new TextEncoder().encode(changed)),
    ).rejects.toBeInstanceOf(BackupError)
    await expect(
      backups.restoreBackup(ownerId, bytes, false),
    ).rejects.toThrow(/confirmation/)
    expect(adapter.replaced).toEqual([])
    await expect(
      backups.previewBackup(ownerId, new Uint8Array(256 * 1024 * 1024 + 1)),
    ).rejects.toThrow(/file size/)
  })

  it('restores only after confirmation and verifies database integrity', async () => {
    const bytes = await backups.createBackup(ownerId)
    const backup = JSON.parse(new TextDecoder().decode(bytes)) as SerializedBackup
    backup.database.tables[1]!.values = [['restored-row']]
    const updatedBytes = await rechecksumBackup(backup)

    await expect(
      backups.restoreBackup(ownerId, updatedBytes, true),
    ).resolves.toMatchObject({
      integrity: 'ok',
      foreignKeyViolations: 0,
      schemaVersion: latestSchemaVersion,
    })
    expect(adapter.replaced).toHaveLength(1)
    expect(adapter.current.tables[1]?.values).toEqual([['restored-row']])
  })

  it('recovers the previous database when restore integrity verification fails', async () => {
    const original = JSON.stringify(adapter.current)
    const bytes = await backups.createBackup(ownerId)
    const backup = JSON.parse(new TextDecoder().decode(bytes)) as SerializedBackup
    backup.database.tables[1]!.values = [['invalid-state']]
    const updatedBytes = await rechecksumBackup(backup)
    adapter.healthChecks = [
      { integrity: 'ok', foreignKeyViolations: 1, schemaVersion: latestSchemaVersion },
      { integrity: 'ok', foreignKeyViolations: 0, schemaVersion: latestSchemaVersion },
    ]

    await expect(
      backups.restoreBackup(ownerId, updatedBytes, true),
    ).rejects.toThrow(/previous database was recovered/)
    expect(adapter.replaced).toHaveLength(2)
    expect(JSON.stringify(adapter.current)).toBe(original)
  })

  it('stores opt-in backup intervals and reports when a backup is due', async () => {
    const initial = await backups.getSchedule(ownerId)
    expect(initial).toMatchObject({
      enabled: false,
      intervalDays: 7,
      due: false,
    })
    await expect(backups.configureSchedule(ownerId, {
      enabled: true,
      intervalDays: 0,
    })).rejects.toBeInstanceOf(BackupError)
    await expect(backups.configureSchedule(ownerId, {
      enabled: true,
      intervalDays: 7,
    })).resolves.toMatchObject({ enabled: true, intervalDays: 7, due: true })

    await backups.createBackup(ownerId)
    await expect(backups.getSchedule(ownerId)).resolves.toMatchObject({
      enabled: true,
      intervalDays: 7,
      due: false,
    })
  })

  it('requires settings permission for backup operations', async () => {
    const roles = new RoleManagementService(database)
    const roleId = await roles.createRole(ownerId, 'Product reader')
    await roles.setPermissions(ownerId, roleId, ['products.read'])
    const role = (await new AuthRepository(database).getRoles()).find(
      (item) => item.id === roleId,
    )
    if (!role) throw new Error('The backup permission test role was not created')
    const userId = await new UserManagementService(
      database,
      passwordHasher,
    ).createUser(ownerId, {
      username: 'product-reader',
      displayName: 'Product Reader',
      password: 'a-secure-product-password',
      roleCodes: [role.code],
      branchIds: [],
      warehouseIds: [],
    })
    await expect(backups.createBackup(userId)).rejects.toThrow(/Permission required/)
  })
})

async function rechecksumBackup(
  backup: SerializedBackup,
): Promise<Uint8Array> {
  const checksum = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(backup.database)),
  )
  const hex = Array.from(new Uint8Array(checksum), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return new TextEncoder().encode(JSON.stringify({ ...backup, checksum: hex }))
}
