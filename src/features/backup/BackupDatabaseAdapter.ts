import { CapacitorSQLite } from '@capacitor-community/sqlite'
import type { capSQLiteImportOptions, JsonSQLite } from '@capacitor-community/sqlite'
import { DATABASE_NAME } from '../../infrastructure/database/CapacitorSqliteDriver'
import { initializeDatabase } from '../../infrastructure/database/setup'
import type { SqliteDatabase } from '../../infrastructure/database/SqliteDatabase'
import type { DatabaseHealth } from '../../infrastructure/database/types'
import { BackupError } from './backup.errors'

export type BackupPayload = {
  database: string
  version: number
  encrypted: boolean
  mode: string
  tables: Array<{
    name: string
    values?: unknown[][] | undefined
    [key: string]: unknown
  }>
  [key: string]: unknown
}

export interface BackupDatabaseAdapter {
  exportDatabase(): Promise<BackupPayload>
  validateDatabase(payload: BackupPayload): Promise<void>
  replaceDatabase(payload: BackupPayload): Promise<void>
  verifyIntegrity(): Promise<DatabaseHealth>
}

export class CapacitorBackupDatabaseAdapter implements BackupDatabaseAdapter {
  private readonly database: SqliteDatabase

  constructor(database: SqliteDatabase) {
    this.database = database
  }

  async exportDatabase(): Promise<BackupPayload> {
    const result = await CapacitorSQLite.exportToJson({
      database: DATABASE_NAME,
      jsonexportmode: 'full',
      encrypted: false,
    })
    if (!result.export) {
      throw new BackupError('SQLite did not return a database backup')
    }
    return result.export as BackupPayload
  }

  async validateDatabase(payload: BackupPayload): Promise<void> {
    const options: capSQLiteImportOptions = {
      jsonstring: JSON.stringify(payload),
    }
    const result = await CapacitorSQLite.isJsonValid(options)
    if (!result.result) {
      throw new BackupError('SQLite rejected the backup database contents')
    }
  }

  async replaceDatabase(payload: BackupPayload): Promise<void> {
    await this.database.close()
    let importError: unknown
    try {
      const replacePayload = JSON.parse(JSON.stringify({
        ...payload,
        database: DATABASE_NAME,
        overwrite: true,
      })) as JsonSQLite
      await CapacitorSQLite.importFromJson({
        jsonstring: JSON.stringify(replacePayload),
      })
    } catch (error) {
      importError = error
    }

    try {
      await this.database.open()
    } catch (openError) {
      if (importError) {
        throw new AggregateError(
          [importError, openError],
          'Database restore failed and the connection could not be reopened',
        )
      }
      throw openError
    }

    if (importError) {
      throw new BackupError('SQLite could not restore the selected backup', {
        cause: importError,
      })
    }
  }

  async verifyIntegrity(): Promise<DatabaseHealth> {
    return initializeDatabase(this.database)
  }
}
