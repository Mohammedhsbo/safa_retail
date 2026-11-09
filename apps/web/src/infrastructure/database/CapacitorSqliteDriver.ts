import { Capacitor } from '@capacitor/core'
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import { DatabaseError } from './errors'
import { SqliteDatabase } from './SqliteDatabase'
import type { SqlParameters, SqlRow, SqliteDriver } from './types'

export const DATABASE_NAME = 'safa-retail'

function isSqlRow(value: unknown): value is SqlRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (field) =>
        field === null ||
        typeof field === 'string' ||
        typeof field === 'number' ||
        field instanceof Uint8Array,
    )
  )
}

function normalizeRows(value: unknown): SqlRow[] {
  if (!Array.isArray(value)) {
    throw new DatabaseError('SQLite returned an invalid query result')
  }

  const rows: SqlRow[] = []

  for (const row of value) {
    if (!isSqlRow(row)) {
      throw new DatabaseError('SQLite returned a row with an unsupported value')
    }

    rows.push(row)
  }

  return rows
}

export class CapacitorSqliteDriver implements SqliteDriver {
  private connection: SQLiteDBConnection | undefined

  async open(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      throw new DatabaseError(
        'The production SQLite database is available only in the native Capacitor application; browser storage is not configured',
      )
    }

    const sqliteConnection = new SQLiteConnection(CapacitorSQLite)
    await sqliteConnection.checkConnectionsConsistency()

    const connectionExists = await sqliteConnection.isConnection(
      DATABASE_NAME,
      false,
    )

    const connection = connectionExists.result
      ? await sqliteConnection.retrieveConnection(DATABASE_NAME, false)
      : await sqliteConnection.createConnection(
          DATABASE_NAME,
          false,
          'no-encryption',
          1,
          false,
        )

    this.connection = connection
    const isOpen = await connection.isDBOpen()
    if (!isOpen.result) {
      await connection.open()
    }

    await this.execute('PRAGMA foreign_keys = ON')
    await this.execute('PRAGMA busy_timeout = 5000')
  }

  async close(): Promise<void> {
    if (!this.connection) {
      return
    }

    const connection = this.connection
    await connection.close()
    this.connection = undefined
  }

  async execute(statement: string): Promise<void> {
    await this.getConnection().execute(statement, false)
  }

  async run(
    statement: string,
    parameters: SqlParameters = [],
  ): Promise<number> {
    const result = await this.getConnection().run(
      statement,
      [...parameters],
      false,
    )

    return result.changes?.changes ?? 0
  }

  async query<Row extends SqlRow = SqlRow>(
    statement: string,
    parameters: SqlParameters = [],
  ): Promise<Row[]> {
    const result = await this.getConnection().query(statement, [...parameters])
    return normalizeRows(result.values).map((row) => row as Row)
  }

  async beginTransaction(): Promise<void> {
    await this.getConnection().beginTransaction()
  }

  async commitTransaction(): Promise<void> {
    await this.getConnection().commitTransaction()
  }

  async rollbackTransaction(): Promise<void> {
    await this.getConnection().rollbackTransaction()
  }

  private getConnection(): SQLiteDBConnection {
    if (!this.connection) {
      throw new DatabaseError('SQLite connection has not been opened')
    }

    return this.connection
  }
}

export async function openNativeSqliteDatabase() {
  const driver = new CapacitorSqliteDriver()
  const database = new SqliteDatabase(driver)

  try {
    await database.open()
    return database
  } catch (error) {
    try {
      await driver.close()
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        'Opening SQLite failed and closing the partial connection also failed',
      )
    }

    throw error
  }
}
