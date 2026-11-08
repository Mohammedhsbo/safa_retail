import BetterSqlite3 from 'better-sqlite3'
import type { SqlParameters, SqlRow, SqliteDriver } from '../../infrastructure/database/types'

function normalizeValue(value: unknown): value is string | number | null | Uint8Array {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    value instanceof Uint8Array
  )
}

function normalizeRows(rows: unknown[]): SqlRow[] {
  return rows.map((row) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new Error('Test SQLite adapter received an invalid row')
    }

    const normalized: Record<string, string | number | null | Uint8Array> = {}

    for (const [key, value] of Object.entries(row)) {
      if (!normalizeValue(value)) {
        throw new Error(`Test SQLite adapter received an invalid value for ${key}`)
      }

      normalized[key] = value
    }

    return normalized
  })
}

function createMemoryDatabase() {
  return new BetterSqlite3(':memory:')
}

export class BetterSqliteTestDriver implements SqliteDriver {
  private connection: ReturnType<typeof createMemoryDatabase> | undefined

  async open(): Promise<void> {
    this.connection = createMemoryDatabase()
    this.connection.pragma('foreign_keys = ON')
  }

  async close(): Promise<void> {
    this.getConnection().close()
    this.connection = undefined
  }

  async execute(statement: string): Promise<void> {
    this.getConnection().exec(statement)
  }

  async run(
    statement: string,
    parameters: SqlParameters = [],
  ): Promise<number> {
    return this.getConnection().prepare(statement).run(...parameters).changes
  }

  async query<Row extends SqlRow = SqlRow>(
    statement: string,
    parameters: SqlParameters = [],
  ): Promise<Row[]> {
    return normalizeRows(
      this.getConnection().prepare(statement).all(...parameters),
    ) as Row[]
  }

  async beginTransaction(): Promise<void> {
    this.getConnection().exec('BEGIN IMMEDIATE')
  }

  async commitTransaction(): Promise<void> {
    this.getConnection().exec('COMMIT')
  }

  async rollbackTransaction(): Promise<void> {
    this.getConnection().exec('ROLLBACK')
  }

  private getConnection() {
    if (!this.connection) {
      throw new Error('Test SQLite database has not been opened')
    }

    return this.connection
  }
}
