import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from './database.js'
import { HttpError } from './errors.js'

const maximumBackupBytes = 256 * 1024 * 1024
const backupFormat = 'safa-retail-postgres-backup'
const backupFormatVersion = 1
const currentSchemaNumber = 2
const schemaVersion = '20261203000000_product_warehouse_availability'
const scheduleKey = 'backup.schedule'

const scheduleInputSchema = z.object({
  enabled: z.boolean(),
  intervalDays: z.number().int().min(1).max(365),
}).strict()

const scheduleSchema = scheduleInputSchema.extend({
  lastBackupCreatedAt: z.string().datetime({ offset: true }).nullable(),
})

const tableSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  columns: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1),
  rows: z.array(z.record(z.string(), z.unknown())),
}).strict()

const backupSchema = z.object({
  format: z.literal(backupFormat),
  formatVersion: z.literal(backupFormatVersion),
  schemaVersion: z.literal(schemaVersion),
  exportedAt: z.string().datetime({ offset: true }),
  tables: z.array(tableSchema).min(1),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

type BackupTable = z.infer<typeof tableSchema>
type BackupSchedule = z.infer<typeof scheduleSchema> & {
  nextBackupDueAt: string | null
  due: boolean
}

type ColumnInfo = { column_name: string }
type ForeignKeyInfo = { child: string; parent: string }

export class PostgresBackupService {
  async createBackup(): Promise<Uint8Array> {
    const tables = await this.getTables()
    const snapshot = await prisma.$transaction(async (transaction) => {
      const values: BackupTable[] = []
      for (const table of tables) {
        const rows = await transaction.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT * FROM "public"."${table.name}"`,
        )
        values.push({ ...table, rows })
      }
      return values
    }, { isolationLevel: 'RepeatableRead', maxWait: 60_000, timeout: 600_000 })

    const unsignedBackup = {
      format: backupFormat,
      formatVersion: backupFormatVersion,
      schemaVersion,
      exportedAt: new Date().toISOString(),
      tables: snapshot,
    }
    const serialized = JSON.stringify(unsignedBackup)
    const bytes = Buffer.from(JSON.stringify({
      ...unsignedBackup,
      checksum: this.checksum(serialized),
    }), 'utf8')
    if (bytes.byteLength > maximumBackupBytes) {
      throw new HttpError(413, 'BACKUP_TOO_LARGE', 'The database backup exceeds the supported 256 MiB limit')
    }

    const schedule = await this.readSchedule()
    await prisma.application_settings.upsert({
      where: { key: scheduleKey },
      create: {
        key: scheduleKey,
        value: JSON.stringify({ ...schedule, lastBackupCreatedAt: unsignedBackup.exportedAt }),
        updated_at: unsignedBackup.exportedAt,
      },
      update: {
        value: JSON.stringify({ ...schedule, lastBackupCreatedAt: unsignedBackup.exportedAt }),
        updated_at: unsignedBackup.exportedAt,
      },
    })
    return new Uint8Array(bytes)
  }

  async previewBackup(bytes: Uint8Array): Promise<{
    exportedAt: string
    schemaVersion: number
    tableCount: number
    rowCount: number
  }> {
    const backup = await this.decodeBackup(bytes)
    const currentTables = await this.getTables()
    this.assertCompatibleTables(backup.tables, currentTables)
    return {
      exportedAt: backup.exportedAt,
      schemaVersion: currentSchemaNumber,
      tableCount: backup.tables.length,
      rowCount: backup.tables.reduce((count, table) => count + table.rows.length, 0),
    }
  }

  async restoreBackup(bytes: Uint8Array, confirmed: boolean, actorId: string): Promise<{
    integrity: 'ok'
    foreignKeyViolations: number
    schemaVersion: number
  }> {
    if (!confirmed) {
      throw new HttpError(400, 'RESTORE_CONFIRMATION_REQUIRED', 'Explicit confirmation is required to restore a backup')
    }
    const backup = await this.decodeBackup(bytes)
    const currentTables = await this.getTables()
    this.assertCompatibleTables(backup.tables, currentTables)
    const orderedTables = await this.orderTables(currentTables)
    const quotedTables = currentTables.map(({ name }) => `"public"."${name}"`).join(', ')

    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`)
      for (const table of orderedTables) {
        const rows = backup.tables.find(({ name }) => name === table.name)?.rows
        if (!rows) throw new HttpError(400, 'INVALID_BACKUP', `Backup is missing table ${table.name}`)
        const columns = table.columns.map((column) => `"${column}"`).join(', ')
        for (const row of rows) {
          const parameters = table.columns.map((column) => row[column])
          const placeholders = parameters.map((_, index) => `$${index + 1}`).join(', ')
          await transaction.$executeRawUnsafe(
            `INSERT INTO "public"."${table.name}" (${columns}) VALUES (${placeholders})`,
            ...parameters,
          )
        }
        const [count] = await transaction.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS count FROM "public"."${table.name}"`,
        )
        if (Number(count?.count ?? -1) !== rows.length) {
          throw new HttpError(500, 'RESTORE_VERIFICATION_FAILED', `Restored row count did not match for ${table.name}`)
        }
      }
      const restoredUsers = backup.tables.find(({ name }) => name === 'users')?.rows ?? []
      const actorExists = restoredUsers.some((user) => user.id === actorId)
      const now = new Date().toISOString()
      await transaction.audit_logs.create({
        data: {
          id: randomUUID(),
          actor_user_id: actorExists ? actorId : null,
          action: 'database.backup_restored',
          entity_type: 'database',
          entity_id: backup.checksum,
          before_data: null,
          after_data: JSON.stringify({
            exportedAt: backup.exportedAt,
            tableCount: backup.tables.length,
          }),
          occurred_at: now,
          created_at: now,
        },
      })
    }, { isolationLevel: 'Serializable', maxWait: 60_000, timeout: 600_000 })

    return {
      integrity: 'ok',
      foreignKeyViolations: 0,
      schemaVersion: currentSchemaNumber,
    }
  }

  async getSchedule(now = new Date()): Promise<BackupSchedule> {
    const schedule = await this.readSchedule()
    const nextBackupDueAt = schedule.lastBackupCreatedAt
      ? new Date(new Date(schedule.lastBackupCreatedAt).getTime() + schedule.intervalDays * 86_400_000).toISOString()
      : null
    return {
      ...schedule,
      nextBackupDueAt,
      due: schedule.enabled && (!nextBackupDueAt || now.getTime() >= new Date(nextBackupDueAt).getTime()),
    }
  }

  async setSchedule(input: unknown): Promise<BackupSchedule> {
    const parsed = scheduleInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new HttpError(400, 'INVALID_BACKUP_SCHEDULE', 'Backup schedule settings are invalid')
    }
    const previous = await this.readSchedule()
    const schedule = scheduleSchema.parse({
      ...parsed.data,
      lastBackupCreatedAt: previous.lastBackupCreatedAt,
    })
    await prisma.application_settings.upsert({
      where: { key: scheduleKey },
      create: { key: scheduleKey, value: JSON.stringify(schedule), updated_at: new Date().toISOString() },
      update: { value: JSON.stringify(schedule), updated_at: new Date().toISOString() },
    })
    return this.getSchedule()
  }

  private async getTables(): Promise<BackupTable[]> {
    const [latestMigration] = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1
    `
    if (latestMigration?.migration_name !== schemaVersion) {
      throw new HttpError(503, 'DATABASE_SCHEMA_NOT_CURRENT', 'The database schema is not at the supported application version')
    }
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('_prisma_migrations', 'auth_sessions')
      ORDER BY table_name
    `
    const result: BackupTable[] = []
    for (const { table_name: name } of tables) {
      if (!/^[a-z][a-z0-9_]*$/.test(name)) {
        throw new HttpError(500, 'UNSUPPORTED_DATABASE_SCHEMA', 'A database table name is not supported by backup')
      }
      const columns = await prisma.$queryRaw<ColumnInfo[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${name}
        ORDER BY ordinal_position
      `
      const columnNames = columns.map(({ column_name }) => column_name)
      if (columnNames.some((column) => !/^[a-z][a-z0-9_]*$/.test(column))) {
        throw new HttpError(500, 'UNSUPPORTED_DATABASE_SCHEMA', `A column in ${name} is not supported by backup`)
      }
      result.push({ name, columns: columnNames, rows: [] })
    }
    if (result.length === 0) {
      throw new HttpError(503, 'DATABASE_SCHEMA_UNAVAILABLE', 'No application tables are available for backup')
    }
    return result
  }

  private async orderTables(tables: BackupTable[]): Promise<BackupTable[]> {
    const names = new Set(tables.map(({ name }) => name))
    const constraints = await prisma.$queryRaw<ForeignKeyInfo[]>`
      SELECT child.relname AS child, parent.relname AS parent
      FROM pg_constraint constraint_row
      JOIN pg_class child ON child.oid = constraint_row.conrelid
      JOIN pg_namespace child_schema ON child_schema.oid = child.relnamespace
      JOIN pg_class parent ON parent.oid = constraint_row.confrelid
      JOIN pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace
      WHERE constraint_row.contype = 'f'
        AND child_schema.nspname = 'public'
        AND parent_schema.nspname = 'public'
    `
    const pending = new Map(tables.map(({ name }) => [name, new Set<string>()]))
    for (const { child, parent } of constraints) {
      if (names.has(child) && names.has(parent) && child !== parent) {
        pending.get(child)?.add(parent)
      }
    }
    const ordered: BackupTable[] = []
    while (pending.size > 0) {
      const ready = [...pending].filter(([, parents]) => parents.size === 0).map(([name]) => name)
      if (ready.length === 0) {
        throw new HttpError(500, 'UNSUPPORTED_DATABASE_SCHEMA', 'The database contains a cyclic table dependency that cannot be restored safely')
      }
      for (const name of ready) {
        const table = tables.find(({ name: tableName }) => tableName === name)
        if (!table) throw new HttpError(500, 'UNSUPPORTED_DATABASE_SCHEMA', `Database table ${name} is unavailable`)
        ordered.push(table)
        pending.delete(name)
      }
      for (const parents of pending.values()) {
        for (const name of ready) parents.delete(name)
      }
    }
    return ordered
  }

  private async readSchedule(): Promise<z.infer<typeof scheduleSchema>> {
    const setting = await prisma.application_settings.findUnique({ where: { key: scheduleKey } })
    if (!setting) return { enabled: false, intervalDays: 7, lastBackupCreatedAt: null }
    let value: unknown
    try {
      value = JSON.parse(setting.value) as unknown
    } catch (error) {
      console.error(JSON.stringify({
        event: 'backup.schedule.invalid',
        message: error instanceof Error ? error.message : 'Invalid JSON value',
      }))
      throw new HttpError(500, 'INVALID_BACKUP_SCHEDULE', 'The stored backup schedule is invalid')
    }
    const parsed = scheduleSchema.safeParse(value)
    if (!parsed.success) {
      throw new HttpError(500, 'INVALID_BACKUP_SCHEDULE', 'The stored backup schedule is invalid')
    }
    return parsed.data
  }

  private async decodeBackup(bytes: Uint8Array): Promise<z.infer<typeof backupSchema>> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > maximumBackupBytes) {
      throw new HttpError(400, 'INVALID_BACKUP', 'The backup file is empty or exceeds the supported 256 MiB limit')
    }
    let value: unknown
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
    } catch (error) {
      console.warn(JSON.stringify({
        event: 'backup.file.invalid',
        message: error instanceof Error ? error.message : 'Invalid JSON value',
      }))
      throw new HttpError(400, 'INVALID_BACKUP', 'The selected file is not a valid JSON backup')
    }
    const parsed = backupSchema.safeParse(value)
    if (!parsed.success) {
      throw new HttpError(400, 'INVALID_BACKUP', 'The selected file is not a compatible SAFA PostgreSQL backup')
    }
    const { checksum, ...unsignedBackup } = parsed.data
    if (this.checksum(JSON.stringify(unsignedBackup)) !== checksum) {
      throw new HttpError(400, 'INVALID_BACKUP_CHECKSUM', 'The backup checksum is invalid or the file was changed')
    }
    return parsed.data
  }

  private assertCompatibleTables(backupTables: BackupTable[], currentTables: BackupTable[]): void {
    const expected = new Map(currentTables.map(({ name, columns }) => [name, columns]))
    const received = new Set<string>()
    for (const table of backupTables) {
      const columns = expected.get(table.name)
      if (!columns || received.has(table.name) || columns.length !== table.columns.length ||
        columns.some((column, index) => column !== table.columns[index])) {
        throw new HttpError(400, 'INCOMPATIBLE_BACKUP_SCHEMA', 'The backup table set or columns do not match this server schema')
      }
      received.add(table.name)
      for (const row of table.rows) {
        const keys = Object.keys(row)
        if (keys.length !== columns.length || columns.some((column) => !Object.hasOwn(row, column))) {
          throw new HttpError(400, 'INVALID_BACKUP', `A row in ${table.name} does not match the table columns`)
        }
      }
    }
    if (received.size !== expected.size) {
      throw new HttpError(400, 'INCOMPATIBLE_BACKUP_SCHEMA', 'The backup does not contain every application table')
    }
  }

  private checksum(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex')
  }
}
