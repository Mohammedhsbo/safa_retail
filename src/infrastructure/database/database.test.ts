// @vitest-environment node
import { Capacitor } from '@capacitor/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CapacitorSqliteDriver } from './CapacitorSqliteDriver'
import { DatabaseError } from './errors'
import {
  applyMigrations,
  latestSchemaVersion,
  migrations,
} from './migrations'
import { ApplicationSettingsRepository } from './repositories/ApplicationSettingsRepository'
import { initializeDatabase } from './setup'
import { SqliteDatabase } from './SqliteDatabase'
import { createUuid, isUuid } from './uuid'
import { BetterSqliteTestDriver } from '../../test/database/BetterSqliteTestDriver'

let database: SqliteDatabase

beforeEach(async () => {
  database = new SqliteDatabase(new BetterSqliteTestDriver())
  await database.open()
})

afterEach(async () => {
  await database.close()
})

describe('SQLite database foundation', () => {
  it('creates the initial relational schema, applies migrations once, and seeds configuration only', async () => {
    const health = await initializeDatabase(database)
    const tables = await database.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    const migrationRows = await database.query<{ version: number }>(
      'SELECT version FROM database_migrations ORDER BY version',
    )
    const settings = new ApplicationSettingsRepository(database)

    expect(health).toEqual({
      integrity: 'ok',
      foreignKeyViolations: 0,
      schemaVersion: latestSchemaVersion,
    })
    expect(tables.map((table) => table.name)).toEqual([
      'application_settings',
      'audit_logs',
      'branches',
      'brands',
      'business_activities',
      'cash_movements',
      'cashboxes',
      'categories',
      'customers',
      'database_migrations',
      'expenses',
      'inventory_balances',
      'inventory_movements',
      'manufacturing_costs',
      'manufacturing_materials',
      'manufacturing_orders',
      'measurement_units',
      'permissions',
      'product_attributes',
      'product_barcodes',
      'product_images',
      'product_unit_conversions',
      'production_outputs',
      'production_stages',
      'products',
      'purchase_items',
      'purchase_payments',
      'purchase_return_items',
      'purchase_returns',
      'purchases',
      'role_permissions',
      'roles',
      'sale_items',
      'sale_payments',
      'sales',
      'sales_return_items',
      'sales_returns',
      'sales_tax_settings',
      'stock_count_items',
      'stock_counts',
      'stock_transfer_items',
      'stock_transfers',
      'suppliers',
      'user_branch_access',
      'user_roles',
      'user_warehouse_access',
      'users',
      'warehouses',
    ])
    expect(migrationRows).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
    ])
    expect(await settings.get('application.locale')).toBe('ar')
    expect(await settings.get('setup.completed')).toBe('false')
    expect(
      await database.query('SELECT id FROM users'),
    ).toEqual([])
    expect(
      await database.query('SELECT id FROM categories'),
    ).toEqual([])

    await settings.set('application.locale', 'en')
    await initializeDatabase(database)

    expect(await settings.get('application.locale')).toBe('en')
    expect(
      await database.query('SELECT version FROM database_migrations ORDER BY version'),
    ).toHaveLength(latestSchemaVersion)
    const balanceColumns = await database.query<{ name: string }>(
      'PRAGMA table_info(inventory_balances)',
    )
    expect(balanceColumns.map((column) => column.name)).toContain(
      'average_unit_cost',
    )
  })

  it('rolls back a failed migration without leaving partial schema changes', async () => {
    await applyMigrations(database)
    const failingMigration = {
      version: 5,
      name: 'failing_migration',
      statements: [
        'CREATE TABLE migration_probe (id TEXT PRIMARY KEY)',
        'CREATE TABLE migration_probe (id TEXT PRIMARY KEY)',
      ],
    } as const

    await expect(
      applyMigrations(database, [...migrations, failingMigration]),
    ).rejects.toThrow()

    expect(
      await database.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'",
      ),
    ).toEqual([])
    expect(
      await database.query('SELECT version FROM database_migrations ORDER BY version'),
    ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }])
  })

  it('upgrades an existing schema version 1 database without changing its ledger data', async () => {
    const initialMigration = migrations[0]
    if (!initialMigration) {
      throw new Error('The initial migration is missing')
    }
    await applyMigrations(database, [initialMigration])

    await database.run(
      `INSERT INTO branches (id, code, name, status, created_at, updated_at)
       VALUES (?, 'legacy', 'Legacy Branch', 'active', ?, ?)`,
      [
        createUuid(),
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    )
    await applyMigrations(database)

    const migrationVersions = await database.query<{ version: number }>(
      'SELECT version FROM database_migrations ORDER BY version',
    )
    const movementColumns = await database.query<{ name: string }>(
      'PRAGMA table_info(inventory_movements)',
    )
    const saleColumns = await database.query<{ name: string }>(
      'PRAGMA table_info(sales)',
    )
    expect(migrationVersions).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
    ])
    expect(movementColumns.map((column) => column.name)).toContain('unit_cost')
    expect(saleColumns.map((column) => column.name)).toContain('tax_rate')
    expect(saleColumns.map((column) => column.name)).toContain('tax_mode')
    const purchaseColumns = await database.query<{ name: string }>(
      'PRAGMA table_info(purchases)',
    )
    expect(purchaseColumns.map((column) => column.name)).toContain(
      'supplier_invoice_number',
    )
    expect(
      await database.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sales_tax_settings'",
      ),
    ).toEqual([{ name: 'sales_tax_settings' }])
    expect(
      await database.query<{ code: string }>(
        "SELECT code FROM branches WHERE code = 'legacy'",
      ),
    ).toEqual([{ code: 'legacy' }])
  })

  it('rejects edits to an already-applied migration', async () => {
    await applyMigrations(database)

    const modifiedMigration = {
      ...migrations[0]!,
      statements: [...migrations[0]!.statements, 'SELECT 1'],
    }

    await expect(
      applyMigrations(database, [modifiedMigration]),
    ).rejects.toThrow(DatabaseError)
  })

  it('serializes a transaction, commits on success, and rolls back on failure', async () => {
    await initializeDatabase(database)

    await expect(
      database.withTransaction(async (transaction) => {
        await transaction.run(
          'INSERT INTO application_settings (key, value, updated_at) VALUES (?, ?, ?)',
          ['transaction.test', 'before-failure', new Date().toISOString()],
        )
        await transaction.run(
          'INSERT INTO application_settings (key, value, updated_at) VALUES (?, ?, ?)',
          ['transaction.test', 'duplicate', new Date().toISOString()],
        )
      }),
    ).rejects.toThrow()

    const settings = new ApplicationSettingsRepository(database)
    expect(await settings.get('transaction.test')).toBeNull()

    await database.withTransaction(async (transaction) => {
      await transaction.run(
        'INSERT INTO application_settings (key, value, updated_at) VALUES (?, ?, ?)',
        ['transaction.committed', 'yes', new Date().toISOString()],
      )
    })

    expect(await settings.get('transaction.committed')).toBe('yes')
  })

  it('enforces foreign keys and protects inventory and audit ledgers from changes', async () => {
    await initializeDatabase(database)

    const userId = createUuid()
    await database.run(
      `INSERT INTO users (id, username, password_hash, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        'test-user',
        'test-hash',
        'Test User',
        'active',
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    )

    await expect(
      database.run(
        'INSERT INTO user_branch_access (user_id, branch_id) VALUES (?, ?)',
        [userId, createUuid()],
      ),
    ).rejects.toThrow()

    const auditId = createUuid()
    await database.run(
      `INSERT INTO audit_logs (id, action, entity_type, entity_id, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        auditId,
        'test',
        'test_entity',
        createUuid(),
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    )

    await expect(
      database.run('UPDATE audit_logs SET action = ? WHERE id = ?', [
        'changed',
        auditId,
      ]),
    ).rejects.toThrow(/immutable/)
    await expect(
      database.run('DELETE FROM audit_logs WHERE id = ?', [auditId]),
    ).rejects.toThrow(/immutable/)
  })

  it('prevents updates and deletes to inventory movement history', async () => {
    await initializeDatabase(database)
    const now = new Date().toISOString()
    const unitId = createUuid()
    const branchId = createUuid()
    const warehouseId = createUuid()
    const productId = createUuid()
    const movementId = createUuid()

    await database.run(
      `INSERT INTO measurement_units
         (id, code, name, dimension, decimal_places, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [unitId, 'ea', 'Each', 'count', 0, 'active', now, now],
    )
    await database.run(
      `INSERT INTO branches (id, code, name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [branchId, 'branch-1', 'Branch 1', 'active', now, now],
    )
    await database.run(
      `INSERT INTO warehouses (id, branch_id, code, name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [warehouseId, branchId, 'main', 'Main', 'active', now, now],
    )
    await database.run(
      `INSERT INTO products
         (id, sku, name, base_unit_id, purchase_price, selling_price, minimum_stock, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        'TEST-1',
        'Test product',
        unitId,
        '0',
        '0',
        '0',
        'active',
        now,
        now,
      ],
    )
    await database.run(
      `INSERT INTO inventory_movements
         (id, product_id, warehouse_id, movement_type, quantity, unit_id, source_type, source_id, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        movementId,
        productId,
        warehouseId,
        'opening',
        '1',
        unitId,
        'test',
        createUuid(),
        now,
        now,
      ],
    )

    await expect(
      database.run('UPDATE inventory_movements SET quantity = ? WHERE id = ?', [
        '2',
        movementId,
      ]),
    ).rejects.toThrow(/immutable/)
    await expect(
      database.run('DELETE FROM inventory_movements WHERE id = ?', [
        movementId,
      ]),
    ).rejects.toThrow(/immutable/)
  })

  it('reports foreign-key violations found in a damaged or imported database', async () => {
    await initializeDatabase(database)
    await database.execute('PRAGMA foreign_keys = OFF')
    await database.run(
      'INSERT INTO user_branch_access (user_id, branch_id) VALUES (?, ?)',
      [createUuid(), createUuid()],
    )

    await expect(database.checkIntegrity(latestSchemaVersion)).rejects.toThrow(
      /foreign key check found 2 violation/,
    )
  })

  it('generates UUID v4 identifiers', () => {
    const id = createUuid()

    expect(isUuid(id)).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
  })

  it('refuses to open production SQLite in a browser environment', async () => {
    const isNativePlatform = vi
      .spyOn(Capacitor, 'isNativePlatform')
      .mockReturnValue(false)

    await expect(new CapacitorSqliteDriver().open()).rejects.toThrow(
      /browser storage is not configured/,
    )
    expect(isNativePlatform).toHaveBeenCalledOnce()
  })
})
