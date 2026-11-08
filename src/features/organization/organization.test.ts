// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../../infrastructure/database/setup'
import { SqliteDatabase } from '../../infrastructure/database/SqliteDatabase'
import { BetterSqliteTestDriver } from '../../test/database/BetterSqliteTestDriver'
import { AccessControlService } from '../auth/AccessControlService'
import { AuthRepository } from '../auth/AuthRepository'
import { AuthenticationService } from '../auth/AuthenticationService'
import { AuthorizationError } from '../auth/auth.errors'
import { RoleManagementService } from '../auth/RoleManagementService'
import { UserManagementService } from '../auth/UserManagementService'
import type { PasswordHasher } from '../auth/auth.types'
import { BusinessConfigurationService } from './BusinessConfigurationService'
import { OrganizationError } from './organization.errors'
import { OrganizationService } from './OrganizationService'

class TestPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return createHash('sha256').update(password).digest('hex')
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    return (await this.hash(password)) === encodedHash
  }
}

let database: SqliteDatabase
let ownerId: string
let authentication: AuthenticationService
let organization: OrganizationService
let businessConfiguration: BusinessConfigurationService
let passwordHasher: PasswordHasher

async function createOwner() {
  const owner = await authentication.setupInitialOwner({
    username: 'owner',
    displayName: 'Owner',
    password: 'a-secure-owner-password',
  })
  ownerId = owner.id
  return owner
}

async function createSettingsManager() {
  const roleManagement = new RoleManagementService(database)
  const roleId = await roleManagement.createRole(ownerId, 'Settings Manager')
  await roleManagement.setPermissions(ownerId, roleId, ['settings.manage'])
  const role = (await new AuthRepository(database).getRoles()).find(
    (item) => item.id === roleId,
  )
  if (!role) {
    throw new Error('Settings manager role was not created')
  }

  const users = new UserManagementService(database, passwordHasher)
  return users.createUser(ownerId, {
    username: 'settingsmanager',
    displayName: 'Settings Manager',
    password: 'a-secure-manager-password',
    roleCodes: [role.code],
    branchIds: [],
    warehouseIds: [],
  })
}

async function createEmployee() {
  return new UserManagementService(database, passwordHasher).createUser(
    ownerId,
    {
      username: 'employee',
      displayName: 'Employee',
      password: 'a-secure-employee-password',
      roleCodes: ['sales_employee'],
      branchIds: [],
      warehouseIds: [],
    },
  )
}

beforeEach(async () => {
  database = new SqliteDatabase(new BetterSqliteTestDriver())
  await database.open()
  await initializeDatabase(database)
  passwordHasher = new TestPasswordHasher()
  authentication = new AuthenticationService(database, passwordHasher)
  organization = new OrganizationService(database)
  businessConfiguration = new BusinessConfigurationService(database)
  ownerId = ''
})

afterEach(async () => {
  await database.close()
})

describe('business configuration and organization', () => {
  it('seeds configurable business activities disabled and preserves their settings', async () => {
    await createOwner()
    await businessConfiguration.initialize()
    let activities = await businessConfiguration.listActivities(ownerId)

    expect(activities.map(({ code, name, enabled }) => [code, name, enabled]))
      .toEqual([
        ['clothing_manufacturing', 'Clothing Manufacturing', false],
        ['detergents_trading', 'Detergents Trading', false],
        ['fabrics_trading', 'Fabrics Trading', false],
      ])

    await businessConfiguration.setActivityEnabled(
      ownerId,
      'fabrics_trading',
      true,
    )
    await businessConfiguration.initialize()
    activities = await businessConfiguration.listActivities(ownerId)
    expect(
      activities.find((activity) => activity.code === 'fabrics_trading')
        ?.enabled,
    ).toBe(true)
    const activityAudit = await database.query<{ action: string }>(
      "SELECT action FROM audit_logs WHERE action = 'business_activity.updated'",
    )
    expect(activityAudit).toHaveLength(1)

    await expect(
      businessConfiguration.setActivityEnabled(
        ownerId,
        'unknown_activity',
        true,
      ),
    ).rejects.toThrow(OrganizationError)
  })

  it('requires settings permission and records organization configuration changes', async () => {
    await createOwner()
    const settingsManagerId = await createSettingsManager()
    const employeeId = await createEmployee()

    await expect(
      organization.listBranches(employeeId),
    ).rejects.toThrow(AuthorizationError)
    await expect(
      businessConfiguration.listActivities(settingsManagerId),
    ).resolves.toHaveLength(3)

    expect(await organization.getProfile(ownerId)).toEqual({
      name: null,
      address: null,
      phone: null,
      email: null,
    })
    await organization.updateProfile(ownerId, {
      name: 'SAFA Retail',
      email: 'admin@example.test',
    })
    await organization.updateProfile(ownerId, { phone: '+1234567890' })
    expect(await organization.getProfile(ownerId)).toEqual({
      name: 'SAFA Retail',
      address: null,
      phone: '+1234567890',
      email: 'admin@example.test',
    })

    await expect(
      organization.updateProfile(ownerId, { email: 'not-an-email' }),
    ).rejects.toThrow(OrganizationError)
    await expect(
      organization.updateProfile(employeeId, { name: 'No access' }),
    ).rejects.toThrow(AuthorizationError)

    const auditRows = await database.query<{ action: string }>(
      'SELECT action FROM audit_logs ORDER BY occurred_at',
    )
    expect(auditRows.map((row) => row.action)).toContain(
      'organization.profile_updated',
    )
  })

  it('creates and edits branches and warehouses, and safely controls warehouse reassignment', async () => {
    await createOwner()
    const firstBranchId = await organization.createBranch(ownerId, {
      code: 'north',
      name: 'North Branch',
      address: '1 Main Street',
      phone: '+111111111',
    })

    const secondBranchId = await organization.createBranch(ownerId, {
      code: 'south',
      name: 'South Branch',
    })
    const firstWarehouseId = await organization.createWarehouse(ownerId, {
      branchId: firstBranchId,
      code: 'main',
      name: 'Main Warehouse',
    })
    const secondWarehouseId = await organization.createWarehouse(ownerId, {
      branchId: firstBranchId,
      code: 'back',
      name: 'Back Warehouse',
    })

    await organization.updateBranch(ownerId, firstBranchId, {
      code: 'northern',
      name: 'Northern Branch',
      address: null,
      phone: null,
    })
    await organization.updateWarehouse(ownerId, firstWarehouseId, {
      branchId: secondBranchId,
      code: 'primary',
      name: 'Primary Warehouse',
    })

    const branches = await organization.listBranches(ownerId)
    const warehouses = await organization.listWarehouses(ownerId)
    expect(branches.find((branch) => branch.id === firstBranchId)).toMatchObject(
      {
        code: 'NORTHERN',
        name: 'Northern Branch',
        address: null,
        status: 'active',
      },
    )
    expect(warehouses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstWarehouseId,
          branchId: secondBranchId,
          code: 'PRIMARY',
        }),
        expect.objectContaining({
          id: secondWarehouseId,
          branchId: firstBranchId,
          code: 'BACK',
        }),
      ]),
    )

    const employeeId = await createEmployee()
    await new UserManagementService(
      database,
      passwordHasher,
    ).setUserAccess(
      ownerId,
      employeeId,
      [secondBranchId],
      [firstWarehouseId],
    )
    await expect(
      organization.updateWarehouse(ownerId, firstWarehouseId, {
        branchId: firstBranchId,
        code: 'primary',
        name: 'Primary Warehouse',
      }),
    ).rejects.toThrow(/operational history or user assignments/)

    await expect(
      organization.createWarehouse(ownerId, {
        branchId: '00000000-0000-4000-8000-000000000000',
        code: 'closed',
        name: 'Closed Branch Warehouse',
      }),
    ).rejects.toThrow(OrganizationError)
  })

  it('lists only active locations assigned to the signed-in user', async () => {
    await createOwner()
    const assignedBranchId = await organization.createBranch(ownerId, {
      code: 'assigned',
      name: 'Assigned Branch',
    })
    const otherBranchId = await organization.createBranch(ownerId, {
      code: 'other',
      name: 'Other Branch',
    })
    const assignedWarehouseId = await organization.createWarehouse(ownerId, {
      branchId: assignedBranchId,
      code: 'assigned-stock',
      name: 'Assigned Warehouse',
    })
    await organization.createWarehouse(ownerId, {
      branchId: assignedBranchId,
      code: 'other-stock',
      name: 'Other Warehouse',
    })

    const userId = await new UserManagementService(
      database,
      passwordHasher,
    ).createUser(ownerId, {
      username: 'scopeduser',
      displayName: 'Scoped User',
      password: 'a-secure-scoped-password',
      roleCodes: ['sales_employee'],
      branchIds: [assignedBranchId],
      warehouseIds: [assignedWarehouseId],
    })

    await expect(
      organization.listAccessibleBranches(userId),
    ).resolves.toEqual([
      expect.objectContaining({ id: assignedBranchId, status: 'active' }),
    ])
    await expect(
      organization.listAccessibleWarehouses(userId, assignedBranchId),
    ).resolves.toEqual([
      expect.objectContaining({
        id: assignedWarehouseId,
        branchId: assignedBranchId,
        status: 'active',
      }),
    ])
    await expect(
      organization.listAccessibleWarehouses(userId, otherBranchId),
    ).rejects.toThrow(AuthorizationError)
  })

  it('archives branches and their warehouses atomically and invalidates access scopes', async () => {
    await createOwner()
    const branchId = await organization.createBranch(ownerId, {
      code: 'archive',
      name: 'Archive Branch',
    })
    const warehouseId = await organization.createWarehouse(ownerId, {
      branchId,
      code: 'main',
      name: 'Main Warehouse',
    })
    const employeeId = await createEmployee()
    await new UserManagementService(
      database,
      passwordHasher,
    ).setUserAccess(ownerId, employeeId, [branchId], [warehouseId])

    await organization.archiveBranch(ownerId, branchId)
    expect(
      (await organization.listBranches(ownerId)).find(
        (branch) => branch.id === branchId,
      )?.status,
    ).toBe('archived')
    expect(
      (await organization.listWarehouses(ownerId)).find(
        (warehouse) => warehouse.id === warehouseId,
      )?.status,
    ).toBe('archived')

    const access = new AccessControlService(database)
    await expect(
      access.assertBranchAccess(employeeId, branchId),
    ).rejects.toThrow(/cannot access this branch/)
    await expect(
      access.assertBranchAccess(ownerId, branchId),
    ).rejects.toThrow(/cannot access this branch/)
    await expect(
      access.assertWarehouseAccess(employeeId, warehouseId, branchId),
    ).rejects.toThrow(/cannot access this warehouse/)
    await expect(
      new UserManagementService(
        database,
        passwordHasher,
      ).setUserAccess(ownerId, employeeId, [branchId], []),
    ).rejects.toThrow(/active branches/)
    await expect(
      organization.createWarehouse(ownerId, {
        branchId,
        code: 'new',
        name: 'New Warehouse',
      }),
    ).rejects.toThrow(/active branch/)

    const archiveAudits = await database.query<{ action: string }>(
      `SELECT action FROM audit_logs
       WHERE entity_id IN (?, ?) ORDER BY occurred_at`,
      [branchId, warehouseId],
    )
    expect(archiveAudits.map((row) => row.action)).toContain('branch.archived')
    expect(archiveAudits.map((row) => row.action)).toContain(
      'warehouse.archived',
    )
  })

  it('archives a warehouse without deleting assignments or allowing further access', async () => {
    await createOwner()
    const branchId = await organization.createBranch(ownerId, {
      code: 'warehouse-archive',
      name: 'Warehouse Archive Branch',
    })
    const warehouseId = await organization.createWarehouse(ownerId, {
      branchId,
      code: 'archive',
      name: 'Archive Warehouse',
    })
    const employeeId = await createEmployee()
    await new UserManagementService(
      database,
      passwordHasher,
    ).setUserAccess(ownerId, employeeId, [branchId], [warehouseId])

    await organization.archiveWarehouse(ownerId, warehouseId)
    expect(
      (await organization.listWarehouses(ownerId)).find(
        (warehouse) => warehouse.id === warehouseId,
      )?.status,
    ).toBe('archived')
    await expect(
      new AccessControlService(database).assertWarehouseAccess(
        employeeId,
        warehouseId,
        branchId,
      ),
    ).rejects.toThrow(/cannot access this warehouse/)
  })

  it('does not allow moving warehouses after inventory history exists', async () => {
    await createOwner()
    const branchA = await organization.createBranch(ownerId, {
      code: 'branch-a',
      name: 'Branch A',
    })
    const branchB = await organization.createBranch(ownerId, {
      code: 'branch-b',
      name: 'Branch B',
    })
    const warehouseId = await organization.createWarehouse(ownerId, {
      branchId: branchA,
      code: 'main',
      name: 'Main Warehouse',
    })

    const now = new Date().toISOString()
    const unitId = '00000000-0000-4000-8000-000000000001'
    const productId = '00000000-0000-4000-8000-000000000002'
    await database.run(
      `INSERT INTO measurement_units
         (id, code, name, dimension, decimal_places, status, created_at, updated_at)
       VALUES (?, 'each', 'Each', 'count', 0, 'active', ?, ?)`,
      [unitId, now, now],
    )
    await database.run(
      `INSERT INTO products
         (id, sku, name, base_unit_id, purchase_price, selling_price,
          minimum_stock, status, created_at, updated_at)
       VALUES (?, 'ITEM-1', 'Item', ?, '0', '0', '0', 'active', ?, ?)`,
      [productId, unitId, now, now],
    )
    await database.run(
      `INSERT INTO inventory_movements
         (id, product_id, warehouse_id, movement_type, quantity, unit_id,
          source_type, source_id, occurred_at, created_at)
       VALUES (?, ?, ?, 'adjustment', '1', ?, 'test', ?, ?, ?)`,
      [
        '00000000-0000-4000-8000-000000000003',
        productId,
        warehouseId,
        unitId,
        '00000000-0000-4000-8000-000000000004',
        now,
        now,
      ],
    )

    await expect(
      organization.updateWarehouse(ownerId, warehouseId, {
        branchId: branchB,
        code: 'main',
        name: 'Main Warehouse',
      }),
    ).rejects.toThrow(/operational history or user assignments/)
  })
})
