import { z } from 'zod'
import type { SqliteDatabase } from '../../infrastructure/database/SqliteDatabase'
import type { DatabaseHealth } from '../../infrastructure/database/types'
import { AccessControlService } from '../auth/AccessControlService'
import { ApplicationSettingsRepository } from '../../infrastructure/database/repositories/ApplicationSettingsRepository'
import { latestSchemaVersion } from '../../infrastructure/database/migrations'
import { DATABASE_NAME } from '../../infrastructure/database/CapacitorSqliteDriver'
import { BackupError } from './backup.errors'
import {
  CapacitorBackupDatabaseAdapter,
  type BackupDatabaseAdapter,
  type BackupPayload,
} from './BackupDatabaseAdapter'

const backupFormat = 'safa-retail-backup'
const backupFormatVersion = 1
const scheduleKey = 'backup.schedule'
export const MAXIMUM_BACKUP_BYTES = 256 * 1024 * 1024

const payloadSchema = z.object({
  database: z.string().min(1),
  version: z.number().int().nonnegative(),
  encrypted: z.boolean(),
  mode: z.literal('full'),
  tables: z.array(z.object({
    name: z.string().min(1),
    values: z.array(z.array(z.unknown())).optional(),
  }).passthrough()).min(1),
}).passthrough()

const envelopeSchema = z.object({
  format: z.literal(backupFormat),
  formatVersion: z.literal(backupFormatVersion),
  schemaVersion: z.number().int().positive(),
  exportedAt: z.string().datetime({ offset: true }),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  database: payloadSchema,
}).strict()

const scheduleSchema = z.object({
  enabled: z.boolean(),
  intervalDays: z.number().int().min(1).max(365),
  lastBackupCreatedAt: z.string().datetime({ offset: true }).nullable(),
})

export type BackupPreview = {
  exportedAt: string
  schemaVersion: number
  tableCount: number
  rowCount: number
}

export type BackupSchedule = z.infer<typeof scheduleSchema> & {
  nextBackupDueAt: string | null
  due: boolean
}

export class BackupService {
  private readonly access: AccessControlService
  private readonly settings: ApplicationSettingsRepository
  private readonly adapter: BackupDatabaseAdapter

  constructor(
    database: SqliteDatabase,
    adapter: BackupDatabaseAdapter = new CapacitorBackupDatabaseAdapter(database),
  ) {
    this.access = new AccessControlService(database)
    this.settings = new ApplicationSettingsRepository(database)
    this.adapter = adapter
  }

  async createBackup(actorId: string): Promise<Uint8Array> {
    await this.assertManagePermission(actorId)
    const payload = await this.adapter.exportDatabase()
    this.assertCompatiblePayload(payload)
    const backup = await this.createEnvelope(payload)
    const bytes = this.encodeBackup(backup)
    const schedule = await this.readSchedule()
    await this.settings.set(scheduleKey, JSON.stringify({
      ...schedule,
      lastBackupCreatedAt: backup.exportedAt,
    }))
    return bytes
  }

  async previewBackup(
    actorId: string,
    bytes: Uint8Array,
  ): Promise<BackupPreview> {
    await this.assertManagePermission(actorId)
    const backup = await this.decodeBackup(bytes)
    await this.adapter.validateDatabase(backup.database)
    return {
      exportedAt: backup.exportedAt,
      schemaVersion: backup.schemaVersion,
      tableCount: backup.database.tables.length,
      rowCount: backup.database.tables.reduce(
        (sum, table) => sum + (table.values?.length ?? 0),
        0,
      ),
    }
  }

  async restoreBackup(
    actorId: string,
    bytes: Uint8Array,
    confirmed: boolean,
  ): Promise<DatabaseHealth> {
    await this.assertManagePermission(actorId)
    if (!confirmed) {
      throw new BackupError('Restore requires explicit user confirmation')
    }
    const backup = await this.decodeBackup(bytes)
    await this.adapter.validateDatabase(backup.database)

    const previousDatabase = await this.adapter.exportDatabase()
    this.assertCompatiblePayload(previousDatabase)
    await this.adapter.validateDatabase(previousDatabase)

    try {
      await this.adapter.replaceDatabase(backup.database)
      const health = await this.adapter.verifyIntegrity()
      if (
        health.integrity !== 'ok' ||
        health.foreignKeyViolations !== 0 ||
        health.schemaVersion !== latestSchemaVersion
      ) {
        throw new BackupError('Restored database did not pass integrity checks')
      }
      await this.settings.set('backup.last_restored_at', new Date().toISOString())
      return health
    } catch (restoreError) {
      try {
        await this.adapter.replaceDatabase(previousDatabase)
        const rollbackHealth = await this.adapter.verifyIntegrity()
        if (
          rollbackHealth.integrity !== 'ok' ||
          rollbackHealth.foreignKeyViolations !== 0 ||
          rollbackHealth.schemaVersion !== latestSchemaVersion
        ) {
          throw new BackupError('The previous database failed integrity checks')
        }
      } catch (rollbackError) {
        throw new AggregateError(
          [restoreError, rollbackError],
          'Database restore failed and the previous database could not be recovered',
        )
      }
      throw new BackupError(
        'Database restore failed; the previous database was recovered',
        { cause: restoreError },
      )
    }
  }

  async configureSchedule(
    actorId: string,
    input: unknown,
  ): Promise<BackupSchedule> {
    await this.assertManagePermission(actorId)
    const parsed = z.object({
      enabled: z.boolean(),
      intervalDays: z.number().int().min(1).max(365),
    }).safeParse(input)
    if (!parsed.success) {
      throw new BackupError('The backup schedule settings are invalid')
    }
    const previous = await this.readSchedule()
    const schedule = scheduleSchema.parse({
      ...parsed.data,
      lastBackupCreatedAt: previous.lastBackupCreatedAt,
    })
    await this.settings.set(scheduleKey, JSON.stringify(schedule))
    return this.scheduleView(schedule)
  }

  async getSchedule(actorId: string): Promise<BackupSchedule> {
    await this.assertManagePermission(actorId)
    return this.scheduleView(await this.readSchedule())
  }

  private async assertManagePermission(actorId: string): Promise<void> {
    await this.access.assertPermission(actorId, 'settings.manage')
  }

  private async readSchedule(): Promise<z.infer<typeof scheduleSchema>> {
    const value = await this.settings.get(scheduleKey)
    if (value === null) {
      return {
        enabled: false,
        intervalDays: 7,
        lastBackupCreatedAt: null,
      }
    }
    try {
      const parsed = scheduleSchema.safeParse(JSON.parse(value) as unknown)
      if (!parsed.success) {
        throw new BackupError('The stored backup schedule is invalid', {
          cause: parsed.error,
        })
      }
      return parsed.data
    } catch (error) {
      if (error instanceof BackupError) throw error
      throw new BackupError('The stored backup schedule is invalid', {
        cause: error,
      })
    }
  }

  private scheduleView(
    schedule: z.infer<typeof scheduleSchema>,
    now = new Date(),
  ): BackupSchedule {
    const nextBackupDueAt = schedule.lastBackupCreatedAt
      ? new Date(
          new Date(schedule.lastBackupCreatedAt).getTime() +
            schedule.intervalDays * 24 * 60 * 60 * 1000,
        ).toISOString()
      : null
    return {
      ...schedule,
      nextBackupDueAt,
      due: schedule.enabled && (
        !nextBackupDueAt || now.getTime() >= new Date(nextBackupDueAt).getTime()
      ),
    }
  }

  private async createEnvelope(
    payload: BackupPayload,
  ): Promise<z.infer<typeof envelopeSchema>> {
    const serializedPayload = JSON.stringify(payload)
    return envelopeSchema.parse({
      format: backupFormat,
      formatVersion: backupFormatVersion,
      schemaVersion: latestSchemaVersion,
      exportedAt: new Date().toISOString(),
      checksum: await this.checksum(serializedPayload),
      database: payload,
    })
  }

  private async decodeBackup(
    bytes: Uint8Array,
  ): Promise<z.infer<typeof envelopeSchema>> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new BackupError('The selected backup file is empty or invalid')
    }
    if (bytes.byteLength > MAXIMUM_BACKUP_BYTES) {
      throw new BackupError('The selected backup exceeds the supported file size')
    }
    let value: unknown
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch (error) {
      throw new BackupError('The selected file is not a valid backup file', {
        cause: error,
      })
    }
    const parsed = envelopeSchema.safeParse(value)
    if (!parsed.success) {
      throw new BackupError('The selected file is not a supported SAFA backup', {
        cause: parsed.error,
      })
    }
    if (
      parsed.data.schemaVersion !== latestSchemaVersion ||
      parsed.data.database.database !== DATABASE_NAME
    ) {
      throw new BackupError(
        'The backup was created for a different database or application schema version',
      )
    }
    this.assertCompatiblePayload(parsed.data.database)
    const checksum = await this.checksum(
      JSON.stringify(parsed.data.database),
    )
    if (checksum !== parsed.data.checksum) {
      throw new BackupError('The backup checksum is invalid or the file was changed')
    }
    return parsed.data
  }

  private assertCompatiblePayload(payload: BackupPayload): void {
    const parsed = payloadSchema.safeParse(payload)
    if (
      !parsed.success ||
      parsed.data.database !== DATABASE_NAME ||
      parsed.data.mode !== 'full' ||
      parsed.data.encrypted ||
      !parsed.data.tables.some((table) => table.name === 'database_migrations')
    ) {
      throw new BackupError('The database backup contents are incompatible')
    }
  }

  private encodeBackup(
    backup: z.infer<typeof envelopeSchema>,
  ): Uint8Array {
    const bytes = new TextEncoder().encode(JSON.stringify(backup))
    if (bytes.byteLength > MAXIMUM_BACKUP_BYTES) {
      throw new BackupError('The generated backup exceeds the supported file size')
    }
    return bytes
  }

  private async checksum(value: string): Promise<string> {
    const cryptoApi = globalThis.crypto
    if (!cryptoApi?.subtle) {
      throw new BackupError('Secure backup validation is unavailable')
    }
    const digest = await cryptoApi.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value),
    )
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
  }
}
