export type SqlValue = string | number | null | Uint8Array
export type SqlParameters = readonly SqlValue[]
export type SqlRow = Readonly<Record<string, SqlValue>>

export interface SqlExecutor {
  execute(statement: string): Promise<void>
  run(statement: string, parameters?: SqlParameters): Promise<number>
  query<Row extends SqlRow = SqlRow>(
    statement: string,
    parameters?: SqlParameters,
  ): Promise<Row[]>
}

export interface SqlDatabase extends SqlExecutor {
  withTransaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T>
}

export interface SqliteDriver extends SqlExecutor {
  open(): Promise<void>
  close(): Promise<void>
  beginTransaction(): Promise<void>
  commitTransaction(): Promise<void>
  rollbackTransaction(): Promise<void>
}

export interface DatabaseHealth {
  integrity: 'ok'
  foreignKeyViolations: number
  schemaVersion: number
}
