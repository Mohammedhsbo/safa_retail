import { z } from 'zod'
import { DatabaseError } from '../errors'
import { initialSchemaStatements } from './001_initial_schema'
import { weightedAverageInventoryStatements } from './002_weighted_average_inventory'
import { salesTaxSettingsStatements } from './003_sales_tax_settings'
import { supplierInvoiceReferenceStatements } from './004_supplier_invoice_reference'
import type { SqliteDatabase } from '../SqliteDatabase'

export interface DatabaseMigration {
  version: number
  name: string
  statements: readonly string[]
}

interface AppliedMigration {
  version: number
  name: string
  checksum: string
}

const appliedMigrationSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().min(1),
  checksum: z.string().min(1),
})

export const migrations: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: 'initial_schema',
    statements: initialSchemaStatements,
  },
  {
    version: 2,
    name: 'weighted_average_inventory',
    statements: weightedAverageInventoryStatements,
  },
  {
    version: 3,
    name: 'sales_tax_settings',
    statements: salesTaxSettingsStatements,
  },
  {
    version: 4,
    name: 'supplier_invoice_reference',
    statements: supplierInvoiceReferenceStatements,
  },
]

export const latestSchemaVersion =
  migrations.at(-1)?.version ?? 0

async function checksumMigration(
  migration: DatabaseMigration,
): Promise<string> {
  const cryptoApi = globalThis.crypto

  if (!cryptoApi?.subtle) {
    throw new DatabaseError(
      'Secure hashing is unavailable; database migrations cannot be verified',
    )
  }

  const content = new TextEncoder().encode(
    JSON.stringify(migration.statements),
  )
  const digest = await cryptoApi.subtle.digest('SHA-256', content)

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function validateMigrationDefinitions(
  definitions: readonly DatabaseMigration[],
): void {
  let expectedVersion = 1
  const names = new Set<string>()

  for (const migration of definitions) {
    if (
      migration.version !== expectedVersion ||
      migration.name.trim().length === 0 ||
      migration.statements.length === 0 ||
      names.has(migration.name)
    ) {
      throw new DatabaseError(
        `Invalid database migration definition at version ${migration.version}`,
      )
    }

    names.add(migration.name)
    expectedVersion += 1
  }
}

async function readAppliedMigrations(
  database: SqliteDatabase,
): Promise<AppliedMigration[]> {
  const rows = await database.query(
    'SELECT version, name, checksum FROM database_migrations ORDER BY version',
  )

  return rows.map((row) => {
    const parsed = appliedMigrationSchema.safeParse(row)

    if (!parsed.success) {
      throw new DatabaseError(
        'The database migration history contains an invalid record',
        { cause: parsed.error },
      )
    }

    return parsed.data
  })
}

export async function applyMigrations(
  database: SqliteDatabase,
  definitions: readonly DatabaseMigration[] = migrations,
): Promise<number> {
  validateMigrationDefinitions(definitions)

  await database.execute(
    `CREATE TABLE IF NOT EXISTS database_migrations (
      version INTEGER PRIMARY KEY NOT NULL CHECK (version > 0),
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`,
  )

  const checksums = new Map<number, string>()
  for (const migration of definitions) {
    checksums.set(migration.version, await checksumMigration(migration))
  }

  const existing = await readAppliedMigrations(database)

  if (existing.length > definitions.length) {
    throw new DatabaseError(
      'The database schema is newer than this application supports',
    )
  }

  for (const applied of existing) {
    const migration = definitions[applied.version - 1]

    if (
      !migration ||
      migration.name !== applied.name ||
      checksums.get(applied.version) !== applied.checksum
    ) {
      throw new DatabaseError(
        `Applied migration ${applied.version} does not match the application migration`,
      )
    }
  }

  for (const migration of definitions) {
    const checksum = checksums.get(migration.version)
    if (!checksum) {
      throw new DatabaseError(
        `Migration ${migration.version} has no verified checksum`,
      )
    }

    await database.withTransaction(async (transaction) => {
      const currentRows = await transaction.query(
        'SELECT version, name, checksum FROM database_migrations ORDER BY version',
      )
      const currentVersions = currentRows.map((row) => {
        const parsed = appliedMigrationSchema.safeParse(row)

        if (!parsed.success) {
          throw new DatabaseError(
            'The database migration history contains an invalid record',
            { cause: parsed.error },
          )
        }

        return parsed.data
      })
      const current = currentVersions.find(
        (applied) => applied.version === migration.version,
      )

      if (current) {
        if (
          current.name !== migration.name ||
          current.checksum !== checksum
        ) {
          throw new DatabaseError(
            `Applied migration ${migration.version} does not match the application migration`,
          )
        }

        return
      }

      const latestVersion = currentVersions.at(-1)?.version ?? 0
      if (migration.version !== latestVersion + 1) {
        throw new DatabaseError(
          `Cannot apply migration ${migration.version} after version ${latestVersion}`,
        )
      }

      for (const statement of migration.statements) {
        await transaction.execute(statement)
      }

      const appliedAt = new Date().toISOString()
      await transaction.run(
        'INSERT INTO database_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        [migration.version, migration.name, checksum, appliedAt],
      )
    })
  }

  return definitions.at(-1)?.version ?? 0
}
