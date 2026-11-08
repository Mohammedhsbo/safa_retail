// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createUuid } from '../../infrastructure/database/uuid'
import { initializeDatabase } from '../../infrastructure/database/setup'
import { SqliteDatabase } from '../../infrastructure/database/SqliteDatabase'
import { BetterSqliteTestDriver } from '../../test/database/BetterSqliteTestDriver'
import { AuthRepository } from '../auth/AuthRepository'
import { AuthenticationService } from '../auth/AuthenticationService'
import { AuthorizationError } from '../auth/auth.errors'
import { RoleManagementService } from '../auth/RoleManagementService'
import { UserManagementService } from '../auth/UserManagementService'
import type { PermissionCode, PasswordHasher } from '../auth/auth.types'
import { OrganizationService } from '../organization/OrganizationService'
import { ProductCatalogService } from '../catalog/ProductCatalogService'
import { InventoryError } from './inventory.errors'
import { InventoryService } from './InventoryService'

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
let inventory: InventoryService
let organization: OrganizationService
let catalog: ProductCatalogService
let passwordHasher: PasswordHasher
let units: Record<string, string>
let productIds: Record<string, string>

async function createOwner() {
  const owner = await authentication.setupInitialOwner({
    username: 'owner',
    displayName: 'Owner',
    password: 'a-secure-owner-password',
  })
  ownerId = owner.id
}

async function createBranch(code: string) {
  const branchId = await organization.createBranch(ownerId, {
    code,
    name: `Branch ${code}`,
  })
  const warehouseId = await organization.createWarehouse(ownerId, {
    branchId,
    code: 'main',
    name: 'Main Warehouse',
    warehouseType: 'fabrics',
  })
  return { branchId, warehouseId }
}

async function createProduct(
  sku: string,
  name = sku,
  baseUnitId = units.KG!,
  conversions: Array<{ unitId: string; factorToBase: string }> = [],
  branchId?: string,
) {
  const id = await catalog.createProduct(ownerId, {
    sku,
    name,
    baseUnitId,
    purchasePrice: '2',
    sellingPrice: '4',
    minimumStock: '0',
    conversions,
  }, branchId)
  productIds[sku] = id
  return id
}

async function createInventoryUser(
  username: string,
  permissions: PermissionCode[],
  branchIds: string[],
  warehouseIds: string[],
) {
  const roleManagement = new RoleManagementService(database)
  const roleId = await roleManagement.createRole(ownerId, `${username} role`)
  await roleManagement.setPermissions(ownerId, roleId, permissions)
  const role = (await new AuthRepository(database).getRoles()).find(
    (item) => item.id === roleId,
  )
  if (!role) {
    throw new Error('The inventory test role was not created')
  }
  return new UserManagementService(database, passwordHasher).createUser(
    ownerId,
    {
      username,
      displayName: username,
      password: 'a-secure-inventory-password',
      roleCodes: [role.code],
      branchIds,
      warehouseIds,
    },
  )
}

beforeEach(async () => {
  database = new SqliteDatabase(new BetterSqliteTestDriver())
  await database.open()
  await initializeDatabase(database)
  passwordHasher = new TestPasswordHasher()
  authentication = new AuthenticationService(database, passwordHasher)
  inventory = new InventoryService(database)
  organization = new OrganizationService(database)
  catalog = new ProductCatalogService(database)
  ownerId = ''
  productIds = {}
  await createOwner()
  await catalog.initializeStandardUnits(ownerId)
  const unitRows = await catalog.listUnits(ownerId)
  units = Object.fromEntries(unitRows.map((unit) => [unit.code, unit.id]))
})

afterEach(async () => {
  await database.close()
})

describe('inventory ledger and weighted-average valuation', () => {
  it('posts exact decimal stock adjustments and maintains weighted-average cost', async () => {
    const { branchId, warehouseId } = await createBranch('cost')
    const productId = await createProduct('STEEL', 'STEEL', units.KG!, [], branchId)

    await inventory.adjustStock(ownerId, {
      productId,
      warehouseId,
      unitId: units.KG,
      quantity: '10',
      direction: 'in',
      unitCost: '2',
      reason: 'Opening receipt',
    })
    await inventory.adjustStock(ownerId, {
      productId,
      warehouseId,
      unitId: units.KG,
      quantity: '10.000',
      direction: 'in',
      unitCost: '4',
      reason: 'Second receipt',
    })

    let balance = await inventory.getBalance(
      ownerId,
      warehouseId,
      productId,
    )
    expect(balance).toMatchObject({
      quantity: '20',
      averageUnitCost: '3',
      inventoryValue: '60',
    })

    await inventory.adjustStock(ownerId, {
      productId,
      warehouseId,
      unitId: units.KG,
      quantity: '5.000',
      direction: 'out',
      reasonType: 'damage',
      reason: 'Damaged stock',
    })
    balance = await inventory.getBalance(ownerId, warehouseId, productId)
    expect(balance).toMatchObject({
      quantity: '15',
      averageUnitCost: '3',
      inventoryValue: '45',
    })

    const valuation = await inventory.getValuation(ownerId, warehouseId)
    expect(valuation).toMatchObject({
      method: 'weighted_average',
      totalValue: '45',
      items: [expect.objectContaining({ productId, inventoryValue: '45' })],
    })
    const movements = await inventory.listMovements(ownerId, {
      warehouseId,
      productId,
    })
    expect(movements.map((item) => item.movementType)).toEqual([
      'damaged_out',
      'adjustment_in',
      'adjustment_in',
    ])
    expect(movements.map((item) => item.unitCost)).toEqual(['3', '4', '2'])

    await inventory.adjustStock(ownerId, {
      productId,
      warehouseId,
      unitId: units.KG,
      quantity: '0.5',
      direction: 'out',
      reasonType: 'missing',
      reason: 'Missing during reconciliation',
    })
    expect(
      (await inventory.listMovements(ownerId, { warehouseId, productId }))[0]
        ?.movementType,
    ).toBe('missing_out')

    await expect(
      inventory.adjustStock(ownerId, {
        productId,
        warehouseId,
        unitId: units.KG,
        quantity: '16',
        direction: 'out',
        reason: 'Excess',
      }),
    ).rejects.toThrow(/Insufficient stock/)
    expect(
      (await inventory.getBalance(ownerId, warehouseId, productId)).quantity,
    ).toBe('14.5')
    expect(branchId).toBeTruthy()
  })

  it('converts only explicitly configured product units using decimal-safe factors', async () => {
    const { branchId, warehouseId } = await createBranch('conversion')
    const productId = await createProduct('LIQUID', 'Liquid', units.L!, [
      { unitId: units.ML!, factorToBase: '0.001' },
    ], branchId)

    await inventory.adjustStock(ownerId, {
      productId,
      warehouseId,
      unitId: units.ML,
      quantity: '1250',
      direction: 'in',
      unitCost: '0.004',
      reason: 'Bottled goods',
    })
    expect(
      await inventory.getBalance(ownerId, warehouseId, productId),
    ).toMatchObject({
      quantity: '1.25',
      averageUnitCost: '4',
      inventoryValue: '5',
    })

    await expect(
      inventory.adjustStock(ownerId, {
        productId,
        warehouseId,
        unitId: units.KG,
        quantity: '1',
        direction: 'in',
        unitCost: '1',
        reason: 'Unconfigured unit',
      }),
    ).rejects.toThrow(/not configured for this product/)
    await expect(
      inventory.adjustStock(ownerId, {
        productId,
        warehouseId,
        unitId: units.ML,
        quantity: '0.1',
        direction: 'in',
        unitCost: '1',
        reason: 'Too precise',
      }),
    ).rejects.toThrow(/fractional precision/)
  })

  it('requires inventory permissions and warehouse/branch scope for reads and adjustments', async () => {
    const first = await createBranch('scopea')
    const second = await createBranch('scopeb')
    const productId = await createProduct('SCOPE', 'SCOPE', units.KG!, [], first.branchId)
    const readerId = await createInventoryUser(
      'inventoryreader',
      ['inventory.read'],
      [first.branchId],
      [first.warehouseId],
    )
    const otherBranchUser = await createInventoryUser(
      'otherbranch',
      ['inventory.read', 'inventory.adjust'],
      [first.branchId],
      [first.warehouseId],
    )

    await expect(
      inventory.getBalance(readerId, first.warehouseId, productId),
    ).resolves.toMatchObject({ quantity: '0' })
    await expect(
      inventory.adjustStock(readerId, {
        productId,
        warehouseId: first.warehouseId,
        unitId: units.KG,
        quantity: '1',
        direction: 'in',
        unitCost: '2',
        reason: 'Not allowed',
      }),
    ).rejects.toThrow(AuthorizationError)
    await expect(
      inventory.getBalance(otherBranchUser, second.warehouseId, productId),
    ).rejects.toThrow(AuthorizationError)
    const secondBranchReader = await createInventoryUser(
      'secondbranchreader',
      ['inventory.read'],
      [second.branchId],
      [second.warehouseId],
    )
    await expect(
      inventory.getBalance(secondBranchReader, second.warehouseId, productId),
    ).rejects.toThrow(AuthorizationError)
    await expect(
      inventory.getBalance(readerId, first.warehouseId, productId),
    ).resolves.toMatchObject({ updatedAt: null })
  })

  it('creates, approves, dispatches, and receives transfers with paired movements', async () => {
    const source = await createBranch('transferfrom')
    const destination = await createBranch('transferto')
    const productId = await createProduct('TRANSFER', 'TRANSFER', units.KG!, [], source.branchId)
    const userId = await createInventoryUser(
      'transferrer',
      ['inventory.read', 'inventory.adjust', 'inventory.transfer'],
      [source.branchId, destination.branchId],
      [source.warehouseId, destination.warehouseId],
    )
    await inventory.adjustStock(userId, {
      productId,
      warehouseId: source.warehouseId,
      unitId: units.KG,
      quantity: '8',
      direction: 'in',
      unitCost: '2.5',
      reason: 'Opening stock',
    })
    const transferId = await inventory.createTransfer(userId, {
      fromWarehouseId: source.warehouseId,
      toWarehouseId: destination.warehouseId,
      notes: 'Internal transfer',
      items: [{ productId, unitId: units.KG, quantity: '3.25' }],
    })

    await expect(
      inventory.dispatchTransfer(userId, transferId),
    ).rejects.toThrow(/Only approved transfers/)
    await inventory.submitTransfer(userId, transferId)
    await inventory.approveTransfer(userId, transferId)
    await inventory.dispatchTransfer(userId, transferId)
    await expect(inventory.getTransfer(userId, transferId)).resolves
      .toMatchObject({
        status: 'in_transit',
        items: [{ productId, quantity: '3.25' }],
      })
    await expect(
      inventory.listTransfers(userId, source.warehouseId),
    ).resolves.toHaveLength(1)
    const readOnlyId = await createInventoryUser(
      'transferreader',
      ['inventory.read'],
      [source.branchId, destination.branchId],
      [source.warehouseId, destination.warehouseId],
    )
    await expect(
      inventory.getTransfer(readOnlyId, transferId),
    ).rejects.toThrow(AuthorizationError)

    expect(
      (await inventory.getBalance(userId, source.warehouseId, productId))
        .quantity,
    ).toBe('4.75')
    await expect(
      inventory.getBalance(userId, destination.warehouseId, productId),
    ).rejects.toThrow(AuthorizationError)
    const outbound = await inventory.listMovements(userId, {
      warehouseId: source.warehouseId,
      productId,
    })
    expect(outbound[0]).toMatchObject({
      movementType: 'transfer_out',
      quantity: '3.25',
      unitCost: '2.5',
      sourceId: transferId,
    })

    await inventory.receiveTransfer(userId, transferId)
    await expect(
      inventory.getBalance(userId, destination.warehouseId, productId),
    ).resolves.toMatchObject({ quantity: '3.25' })
    expect(
      (await inventory.getBalance(
        userId,
        destination.warehouseId,
        productId,
      )).quantity,
    ).toBe('3.25')
    expect(
      (await inventory.getBalance(
        userId,
        destination.warehouseId,
        productId,
      )).averageUnitCost,
    ).toBe('2.5')
    const incoming = await inventory.listMovements(userId, {
      warehouseId: destination.warehouseId,
      productId,
    })
    expect(incoming[0]).toMatchObject({
      movementType: 'transfer_in',
      quantity: '3.25',
      unitCost: '2.5',
      sourceId: transferId,
    })
    await expect(
      inventory.receiveTransfer(userId, transferId),
    ).rejects.toThrow(/Only in-transit transfers/)

    const paired = await database.query<{ movement_type: string }>(
      `SELECT movement_type FROM inventory_movements
       WHERE source_type = 'stock_transfer' AND source_id = ?
       ORDER BY movement_type`,
      [transferId],
    )
    expect(paired.map((item) => item.movement_type)).toEqual([
      'transfer_in',
      'transfer_out',
    ])
  })

  it('rolls back all lines of a dispatch when one item is short of stock', async () => {
    const source = await createBranch('rollbackfrom')
    const destination = await createBranch('rollbackto')
    const firstProduct = await createProduct('TRANSFER-A', 'TRANSFER-A', units.KG!, [], source.branchId)
    const secondProduct = await createProduct('TRANSFER-B', 'TRANSFER-B', units.KG!, [], source.branchId)
    const userId = await createInventoryUser(
      'rollbacktransfer',
      ['inventory.read', 'inventory.adjust', 'inventory.transfer'],
      [source.branchId, destination.branchId],
      [source.warehouseId, destination.warehouseId],
    )
    await inventory.adjustStock(userId, {
      productId: firstProduct,
      warehouseId: source.warehouseId,
      unitId: units.KG,
      quantity: '10',
      direction: 'in',
      unitCost: '1',
      reason: 'Opening first',
    })
    await inventory.adjustStock(userId, {
      productId: secondProduct,
      warehouseId: source.warehouseId,
      unitId: units.KG,
      quantity: '1',
      direction: 'in',
      unitCost: '1',
      reason: 'Opening second',
    })
    const transferId = await inventory.createTransfer(userId, {
      fromWarehouseId: source.warehouseId,
      toWarehouseId: destination.warehouseId,
      items: [
        { productId: firstProduct, unitId: units.KG, quantity: '5' },
        { productId: secondProduct, unitId: units.KG, quantity: '2' },
      ],
    })
    await inventory.submitTransfer(userId, transferId)
    await inventory.approveTransfer(userId, transferId)
    await expect(
      inventory.dispatchTransfer(userId, transferId),
    ).rejects.toThrow(/Insufficient stock/)

    expect(
      (await inventory.getBalance(userId, source.warehouseId, firstProduct))
        .quantity,
    ).toBe('10')
    expect(
      await database.query(
        `SELECT id FROM inventory_movements
         WHERE source_type = 'stock_transfer' AND source_id = ?`,
        [transferId],
      ),
    ).toEqual([])
  })

  it('reconciles stock counts against current balances and applies changes once', async () => {
    const { branchId, warehouseId } = await createBranch('count')
    const productId = await createProduct('COUNTED', 'COUNTED', units.KG!, [], branchId)
    const counterId = await createInventoryUser(
      'counter',
      ['inventory.read', 'inventory.adjust', 'inventory.count'],
      [branchId],
      [warehouseId],
    )
    await inventory.adjustStock(counterId, {
      productId,
      warehouseId,
      unitId: units.KG,
      quantity: '10',
      direction: 'in',
      unitCost: '2',
      reason: 'Opening stock',
    })

    const countId = await inventory.createStockCount(counterId, {
      warehouseId,
      productIds: [productId],
    })
    await expect(
      inventory.getStockCount(counterId, countId),
    ).resolves.toMatchObject({
      status: 'draft',
      items: [{ productId, expectedQuantity: '10', countedQuantity: null }],
    })
    await expect(
      inventory.listStockCounts(counterId, warehouseId),
    ).resolves.toHaveLength(1)
    await inventory.startStockCount(counterId, countId)
    await inventory.recordStockCount(counterId, countId, {
      productId,
      unitId: units.KG,
      countedQuantity: '7',
      notes: 'Three damaged units',
    })

    await inventory.adjustStock(counterId, {
      productId,
      warehouseId,
      unitId: units.KG,
      quantity: '2',
      direction: 'in',
      unitCost: '5',
      reason: 'Received during count',
    })
    await inventory.approveStockCount(counterId, countId)
    expect(
      (await inventory.getBalance(counterId, warehouseId, productId))
        .quantity,
    ).toBe('7')
    expect(
      (await inventory.getBalance(counterId, warehouseId, productId))
        .averageUnitCost,
    ).toBe('2.5')
    await expect(
      inventory.approveStockCount(counterId, countId),
    ).rejects.toThrow(/Only active stock counts/)

    const changes = await database.query<{ movement_type: string; quantity: string }>(
      `SELECT movement_type, quantity FROM inventory_movements
       WHERE source_type = 'stock_count' AND source_id = ?`,
      [countId],
    )
    expect(changes).toEqual([
      { movement_type: 'count_adjustment_out', quantity: '5' },
    ])
  })

  it('requires complete counts and refuses direct movement edits and invalid identifiers', async () => {
    const { branchId, warehouseId } = await createBranch('countinvalid')
    const productId = await createProduct('COUNT-INVALID', 'COUNT-INVALID', units.KG!, [], branchId)
    const counterId = await createInventoryUser(
      'countinvaliduser',
      ['inventory.read', 'inventory.count'],
      [branchId],
      [warehouseId],
    )
    const countId = await inventory.createStockCount(counterId, {
      warehouseId,
      productIds: [productId],
    })
    await inventory.startStockCount(counterId, countId)
    await expect(
      inventory.approveStockCount(counterId, countId),
    ).rejects.toThrow(/Every stock count item/)
    await expect(
      inventory.recordStockCount(counterId, countId, {
        productId: createUuid(),
        unitId: units.KG,
        countedQuantity: '1',
      }),
    ).rejects.toThrow(/not part of this stock count/)
    await expect(
      inventory.listMovements(counterId, {
        warehouseId: createUuid(),
        limit: 5000,
      }),
    ).rejects.toThrow(InventoryError)

    const { branchId: otherBranchId, warehouseId: otherWarehouse } = await createBranch('immutability')
    const stockedProductId = await createProduct('IMMUTABLE', 'IMMUTABLE', units.KG!, [], otherBranchId)
    const adjusterId = await createInventoryUser(
      'adjuster',
      ['inventory.adjust', 'inventory.read'],
      [branchId, (await organization.listBranches(ownerId)).find((b) => b.code === 'IMMUTABILITY')!.id],
      [warehouseId, otherWarehouse],
    )
    const movementId = await inventory.adjustStock(adjusterId, {
      productId: stockedProductId,
      warehouseId: otherWarehouse,
      unitId: units.KG,
      quantity: '1',
      direction: 'in',
      unitCost: '1',
      reason: 'Opening stock',
    })
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
})
