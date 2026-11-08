import { DatabaseError } from './errors'
import { applyMigrations } from './migrations'
import { ApplicationSettingsRepository } from './repositories/ApplicationSettingsRepository'
import type { DatabaseHealth } from './types'
import { openNativeSqliteDatabase } from './CapacitorSqliteDriver'
import type { SqliteDatabase } from './SqliteDatabase'

const INITIAL_CONFIGURATION = [
  ['application.locale', 'ar'],
  ['setup.completed', 'false'],
] as const

export async function initializeDatabase(
  database: SqliteDatabase,
): Promise<DatabaseHealth> {
  await database.execute('PRAGMA foreign_keys = ON')

  const schemaVersion = await applyMigrations(database)

  await database.withTransaction(async (transaction) => {
    const settings = new ApplicationSettingsRepository(transaction)

    for (const [key, value] of INITIAL_CONFIGURATION) {
      if ((await settings.get(key)) === null) {
        await settings.set(key, value)
      }
    }
  })

  const health = await database.checkIntegrity(schemaVersion)
  if (health.integrity !== 'ok' || health.foreignKeyViolations !== 0) {
    throw new DatabaseError('Database initialization failed integrity checks')
  }

  return health
}

export async function openAndInitializeNativeDatabase() {
  const database = await openNativeSqliteDatabase()

  try {
    const health = await initializeDatabase(database)
    return { database, health }
  } catch (error) {
    try {
      await database.close()
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        'Database initialization failed and the connection could not be closed',
      )
    }

    throw error
  }
}
