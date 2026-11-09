import { AsyncMutex } from './AsyncMutex'
import { DatabaseError } from './errors'
import type {
  DatabaseHealth,
  SqlDatabase,
  SqlExecutor,
  SqlParameters,
  SqlRow,
  SqliteDriver,
} from './types'

export class SqliteDatabase implements SqlDatabase {
  private readonly mutex = new AsyncMutex()
  private opened = false
  private closed = false
  private readonly driver: SqliteDriver

  constructor(driver: SqliteDriver) {
    this.driver = driver
  }

  async open(): Promise<void> {
    await this.mutex.runExclusive(async () => {
      if (this.opened && !this.closed) {
        return
      }

      await this.driver.open()
      this.opened = true
      this.closed = false
    })
  }

  async close(): Promise<void> {
    await this.mutex.runExclusive(async () => {
      this.assertOpen()
      await this.driver.close()
      this.closed = true
    })
  }

  async execute(statement: string): Promise<void> {
    await this.mutex.runExclusive(async () => {
      this.assertOpen()
      await this.driver.execute(statement)
    })
  }

  async run(
    statement: string,
    parameters: SqlParameters = [],
  ): Promise<number> {
    return this.mutex.runExclusive(async () => {
      this.assertOpen()
      return this.driver.run(statement, parameters)
    })
  }

  async query<Row extends SqlRow = SqlRow>(
    statement: string,
    parameters: SqlParameters = [],
  ): Promise<Row[]> {
    return this.mutex.runExclusive(async () => {
      this.assertOpen()
      return this.driver.query<Row>(statement, parameters)
    })
  }

  async withTransaction<T>(work: (transaction: SqlExecutor) => Promise<T>) {
    return this.mutex.runExclusive(async () => {
      this.assertOpen()
      await this.driver.beginTransaction()

      const transactionMutex = new AsyncMutex()
      const transaction: SqlExecutor = {
        execute: (statement) =>
          transactionMutex.runExclusive(() => this.driver.execute(statement)),
        run: (statement, parameters = []) =>
          transactionMutex.runExclusive(() =>
            this.driver.run(statement, parameters),
          ),
        query: <Row extends SqlRow = SqlRow>(
          statement: string,
          parameters: SqlParameters = [],
        ) =>
          transactionMutex.runExclusive(() =>
            this.driver.query<Row>(statement, parameters),
          ),
      }

      try {
        const result = await work(transaction)
        await this.driver.commitTransaction()
        return result
      } catch (error) {
        try {
          await this.driver.rollbackTransaction()
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Database transaction failed and rollback also failed',
          )
        }

        throw error
      }
    })
  }

  async checkIntegrity(schemaVersion: number): Promise<DatabaseHealth> {
    return this.mutex.runExclusive(async () => {
      this.assertOpen()

      const integrityRows = await this.driver.query<{ integrity_check: string }>(
        'PRAGMA integrity_check',
      )
      const integrityResult = integrityRows[0]?.integrity_check

      if (integrityResult !== 'ok') {
        throw new DatabaseError(
          `SQLite integrity check failed: ${String(integrityResult ?? 'no result')}`,
        )
      }

      const foreignKeyViolations =
        await this.driver.query('PRAGMA foreign_key_check')

      if (foreignKeyViolations.length > 0) {
        throw new DatabaseError(
          `SQLite foreign key check found ${foreignKeyViolations.length} violation(s)`,
        )
      }

      return {
        integrity: 'ok',
        foreignKeyViolations: 0,
        schemaVersion,
      }
    })
  }

  private assertOpen(): void {
    if (!this.opened || this.closed) {
      throw new DatabaseError('The SQLite database connection is not open')
    }
  }
}
