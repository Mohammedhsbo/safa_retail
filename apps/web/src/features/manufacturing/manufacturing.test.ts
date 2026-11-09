// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../../infrastructure/database/setup'
import { SqliteDatabase } from '../../infrastructure/database/SqliteDatabase'
import { BetterSqliteTestDriver } from '../../test/database/BetterSqliteTestDriver'
import { AuthRepository } from '../auth/AuthRepository'
import { AuthenticationService } from '../auth/AuthenticationService'
import { AuthorizationError } from '../auth/auth.errors'
import { RoleManagementService } from '../auth/RoleManagementService'
import { UserManagementService } from '../auth/UserManagementService'
import type { PasswordHasher, PermissionCode } from '../auth/auth.types'
import { ProductCatalogService } from '../catalog/ProductCatalogService'
import { InventoryService } from '../inventory/InventoryService'
import { OrganizationService } from '../organization/OrganizationService'
import { ManufacturingError } from './manufacturing.errors'
import { ManufacturingService } from './ManufacturingService'

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
let branchId: string
let warehouseId: string
let finishedProductId: string
let rawMaterialId: string
let unitId: string
let authentication: AuthenticationService
let catalog: ProductCatalogService
let inventory: InventoryService
let organization: OrganizationService
let manufacturing: ManufacturingService
let passwordHasher: PasswordHasher

async function createManufacturingUser(
  username: string,
  permissions: PermissionCode[],
  warehouseIds: string[] = [warehouseId],
): Promise<string> {
  const roles = new RoleManagementService(database)
  const roleId = await roles.createRole(ownerId, `${username} role`)
  await roles.setPermissions(ownerId, roleId, permissions)
  const role = (await new AuthRepository(database).getRoles()).find(
    (item) => item.id === roleId,
  )
  if (!role) {
    throw new Error('The manufacturing test role was not created')
  }
  return new UserManagementService(database, passwordHasher).createUser(
    ownerId,
    {
      username,
      displayName: username,
      password: 'a-secure-manufacturing-password',
      roleCodes: [role.code],
      branchIds: [branchId],
      warehouseIds,
    },
  )
}

async function createOrder() {
  return manufacturing.createOrder(ownerId, {
    warehouseId,
    finishedProductId,
    plannedQuantity: '5',
    materials: [{
      productId: rawMaterialId,
      unitId,
      plannedQuantity: '5',
    }],
    stages: ['Preparation', 'Assembly'],
    notes: 'Test batch',
  })
}

beforeEach(async () => {
  database = new SqliteDatabase(new BetterSqliteTestDriver())
  await database.open()
  await initializeDatabase(database)
  passwordHasher = new TestPasswordHasher()
  authentication = new AuthenticationService(database, passwordHasher)
  catalog = new ProductCatalogService(database)
  inventory = new InventoryService(database)
  organization = new OrganizationService(database)
  manufacturing = new ManufacturingService(database)
  const owner = await authentication.setupInitialOwner({
    username: 'owner',
    displayName: 'Owner',
    password: 'a-secure-owner-password',
  })
  ownerId = owner.id
  await catalog.initializeStandardUnits(ownerId)
  unitId = Object.fromEntries(
    (await catalog.listUnits(ownerId)).map((unit) => [unit.code, unit.id]),
  ).PC!
  branchId = await organization.createBranch(ownerId, {
    code: 'manufacturing',
    name: 'Manufacturing Branch',
  })
  warehouseId = await organization.createWarehouse(ownerId, {
    branchId,
    code: 'factory',
    name: 'Factory Warehouse',
    warehouseType: 'clothing_manufacturing',
  })
  finishedProductId = await catalog.createProduct(ownerId, {
    sku: 'FINISHED-001',
    name: 'Finished Product',
    baseUnitId: unitId,
    purchasePrice: '0',
    sellingPrice: '20',
    minimumStock: '0',
  }, branchId)
  rawMaterialId = await catalog.createProduct(ownerId, {
    sku: 'RAW-001',
    name: 'Raw Material',
    baseUnitId: unitId,
    purchasePrice: '4',
    sellingPrice: '6',
    minimumStock: '0',
  }, branchId)
})

afterEach(async () => {
  await database.close()
})

describe('manufacturing orders', () => {
  it('creates and plans requirements without changing inventory', async () => {
    const orderId = await createOrder()
    const order = await manufacturing.getOrder(ownerId, orderId)
    expect(order).toMatchObject({
      orderNumber: 'MFG-000001',
      status: 'draft',
      plannedQuantity: '5',
      finishedProductId,
      materials: [{
        productId: rawMaterialId,
        plannedQuantity: '5',
        consumedQuantity: null,
      }],
      stages: [
        { name: 'Preparation', sequence: 0, status: 'pending' },
        { name: 'Assembly', sequence: 1, status: 'pending' },
      ],
      materialCost: '0',
      totalCost: '0',
    })
    expect(
      (await inventory.getBalance(ownerId, warehouseId, rawMaterialId)).quantity,
    ).toBe('0')
    expect(
      (await inventory.getBalance(ownerId, warehouseId, finishedProductId)).quantity,
    ).toBe('0')
    await manufacturing.planOrder(ownerId, orderId)
    expect((await manufacturing.getOrder(ownerId, orderId)).status).toBe('planned')
    expect(await manufacturing.listOrders(ownerId, branchId)).toHaveLength(1)
  })

  it('consumes materials at weighted-average cost, records stages/costs, tracks waste, and approves finished stock', async () => {
    await inventory.adjustStock(ownerId, {
      productId: rawMaterialId,
      warehouseId,
      unitId,
      quantity: '10',
      direction: 'in',
      unitCost: '4',
      reason: 'Opening raw materials',
    })
    const orderId = await createOrder()
    await manufacturing.planOrder(ownerId, orderId)
    await manufacturing.startOrder(ownerId, orderId)
    const order = await manufacturing.getOrder(ownerId, orderId)
    const [first, second] = order.stages
    if (!first || !second) {
      throw new Error('Production stages were not created')
    }
    await expect(manufacturing.startStage(ownerId, second.id)).rejects.toThrow(
      /handled in sequence/,
    )
    await manufacturing.startStage(ownerId, first.id)
    await manufacturing.completeStage(ownerId, first.id)
    await manufacturing.startStage(ownerId, second.id)
    await manufacturing.completeStage(ownerId, second.id)
    await manufacturing.addProductionCost(ownerId, orderId, {
      costType: 'labor',
      amount: '4',
      description: 'Batch labor',
    })
    await manufacturing.consumeMaterials(ownerId, orderId, {
      materials: [{ materialId: order.materials[0]!.id, quantity: '2' }],
    })
    await manufacturing.consumeMaterials(ownerId, orderId, {
      materials: [{ materialId: order.materials[0]!.id, quantity: '2' }],
    })
    expect((await inventory.getBalance(ownerId, warehouseId, rawMaterialId)).quantity).toBe('6')
    const consumed = await manufacturing.getOrder(ownerId, orderId)
    expect(consumed).toMatchObject({
      status: 'in_progress',
      materialCost: '16',
      additionalCost: '4',
      totalCost: '20',
      materials: [{ consumedQuantity: '4', unitCost: '4' }],
    })
    await expect(
      manufacturing.consumeMaterials(ownerId, orderId, {
        materials: [{ materialId: order.materials[0]!.id, quantity: '2' }],
      }),
    ).rejects.toThrow(/exceeds or is invalid/)
    await expect(
      manufacturing.completeOrder(ownerId, orderId, {
        actualQuantity: '4',
        wasteQuantity: '2',
      }),
    ).rejects.toThrow(/cannot exceed planned/)
    await manufacturing.completeOrder(ownerId, orderId, {
      actualQuantity: '3',
      wasteQuantity: '1',
    })
    expect((await inventory.getBalance(ownerId, warehouseId, finishedProductId)).quantity).toBe('0')
    expect((await manufacturing.getOrder(ownerId, orderId)).status).toBe('completed')
    await manufacturing.approveFinishedGoods(ownerId, orderId)
    expect((await manufacturing.getOrder(ownerId, orderId)).status).toBe('approved')
    expect(
      (await inventory.getBalance(ownerId, warehouseId, finishedProductId)),
    ).toMatchObject({ quantity: '3', averageUnitCost: '6.666666667' })
    expect(
      await database.query(
        `SELECT movement_type, source_type, unit_cost FROM inventory_movements
         WHERE source_type IN ('manufacturing_order', 'production_output')
         ORDER BY movement_type`,
      ),
    ).toEqual([
      {
        movement_type: 'manufacturing_material_out',
        source_type: 'manufacturing_order',
        unit_cost: '4',
      },
      {
        movement_type: 'manufacturing_material_out',
        source_type: 'manufacturing_order',
        unit_cost: '4',
      },
      {
        movement_type: 'production_in',
        source_type: 'production_output',
        unit_cost: '6.666666667',
      },
    ])
    expect(
      await database.query(
        `SELECT action FROM audit_logs
         WHERE entity_type IN ('manufacturing_order', 'production_output')
         ORDER BY occurred_at, id`,
      ),
    ).toHaveLength(7)
  })

  it('rolls back all material movements when a batch lacks stock', async () => {
    await inventory.adjustStock(ownerId, {
      productId: rawMaterialId,
      warehouseId,
      unitId,
      quantity: '2',
      direction: 'in',
      unitCost: '4',
      reason: 'Limited raw material',
    })
    const secondRaw = await catalog.createProduct(ownerId, {
      sku: 'RAW-002',
      name: 'Second Raw Material',
      baseUnitId: unitId,
      purchasePrice: '2',
      sellingPrice: '3',
      minimumStock: '0',
    }, branchId)
    const orderId = await manufacturing.createOrder(ownerId, {
      warehouseId,
      finishedProductId,
      plannedQuantity: '2',
      materials: [
        { productId: rawMaterialId, unitId, plannedQuantity: '1' },
        { productId: secondRaw, unitId, plannedQuantity: '1' },
      ],
    })
    await manufacturing.planOrder(ownerId, orderId)
    await manufacturing.startOrder(ownerId, orderId)
    const order = await manufacturing.getOrder(ownerId, orderId)
    await expect(
      manufacturing.consumeMaterials(ownerId, orderId, {
        materials: order.materials.map((material) => ({
          materialId: material.id,
          quantity: '1',
        })),
      }),
    ).rejects.toThrow(/Insufficient stock/)
    expect(
      (await inventory.getBalance(ownerId, warehouseId, rawMaterialId)).quantity,
    ).toBe('2')
    expect(
      await database.query(
        `SELECT id FROM inventory_movements
         WHERE source_type = 'manufacturing_order' AND source_id = ?`,
        [orderId],
      ),
    ).toEqual([])
    expect((await manufacturing.getOrder(ownerId, orderId)).materials).toMatchObject([
      { consumedQuantity: null },
      { consumedQuantity: null },
    ])
  })

  it('enforces manufacturing permission, branch/warehouse scope, and safe cancellation', async () => {
    const readerId = await createManufacturingUser('manufacturingreader', [])
    await expect(
      manufacturing.createOrder(readerId, {
        warehouseId,
        finishedProductId,
        plannedQuantity: '1',
        materials: [{ productId: rawMaterialId, unitId, plannedQuantity: '1' }],
      }),
    ).rejects.toThrow(AuthorizationError)
    const branchOnlyId = await createManufacturingUser(
      'branchonlymanufacturing',
      ['manufacturing.manage'],
      [],
    )
    const orderId = await createOrder()
    expect(await manufacturing.listOrders(branchOnlyId, branchId)).toEqual([])
    await expect(manufacturing.getOrder(branchOnlyId, orderId)).rejects.toThrow(
      AuthorizationError,
    )
    await manufacturing.cancelOrder(ownerId, orderId)
    expect((await manufacturing.getOrder(ownerId, orderId)).status).toBe('cancelled')
    await expect(manufacturing.planOrder(ownerId, orderId)).rejects.toThrow(
      /cannot move to planned/,
    )
  })

  it('rejects invalid quantities, duplicate requirements, and completion before consumption', async () => {
    await expect(
      manufacturing.createOrder(ownerId, {
        warehouseId,
        finishedProductId,
        plannedQuantity: '0',
        materials: [{ productId: rawMaterialId, unitId, plannedQuantity: '1' }],
      }),
    ).rejects.toThrow(ManufacturingError)
    await expect(
      manufacturing.createOrder(ownerId, {
        warehouseId,
        finishedProductId,
        plannedQuantity: '1',
        materials: [
          { productId: rawMaterialId, unitId, plannedQuantity: '1' },
          { productId: rawMaterialId, unitId, plannedQuantity: '2' },
        ],
      }),
    ).rejects.toThrow(/details are invalid/)
    const orderId = await createOrder()
    await manufacturing.planOrder(ownerId, orderId)
    await manufacturing.startOrder(ownerId, orderId)
    await expect(
      manufacturing.completeOrder(ownerId, orderId, {
        actualQuantity: '1',
        wasteQuantity: '0',
      }),
    ).rejects.toThrow(/material requirement must have recorded consumption/)
  })
})
