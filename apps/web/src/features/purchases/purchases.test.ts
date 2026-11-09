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
import { PurchasesError } from './purchases.errors'
import { PurchasesService } from './PurchasesService'

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
let supplierId: string
let productId: string
let unitId: string
let authentication: AuthenticationService
let catalog: ProductCatalogService
let inventory: InventoryService
let organization: OrganizationService
let purchases: PurchasesService
let passwordHasher: PasswordHasher

async function createPurchasesUser(
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
    throw new Error('The purchases test role was not created')
  }
  return new UserManagementService(database, passwordHasher).createUser(
    ownerId,
    {
      username,
      displayName: username,
      password: 'a-secure-purchases-password',
      roleCodes: [role.code],
      branchIds: [branchId],
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
  catalog = new ProductCatalogService(database)
  inventory = new InventoryService(database)
  organization = new OrganizationService(database)
  purchases = new PurchasesService(database)
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
    code: 'purchase',
    name: 'Purchase Branch',
  })
  warehouseId = await organization.createWarehouse(ownerId, {
    branchId,
    code: 'main',
    name: 'Main Warehouse',
    warehouseType: 'fabrics',
  })
  supplierId = await purchases.createSupplier(ownerId, {
    code: 'SUP-001',
    name: 'Local Supplier',
    phone: '+123456789',
    email: 'supplier@example.test',
  })
  productId = await catalog.createProduct(ownerId, {
    sku: 'PURCHASE-ITEM',
    name: 'Purchase Item',
    baseUnitId: unitId,
    purchasePrice: '5',
    sellingPrice: '10',
    minimumStock: '0',
  }, branchId)
})

afterEach(async () => {
  await database.close()
})

describe('suppliers and purchase workflows', () => {
  it('creates drafts without stock, receives atomically, records partial payments, and builds supplier statements', async () => {
    await purchases.updateSupplier(ownerId, supplierId, {
      code: 'SUP-001',
      name: 'Updated Local Supplier',
      phone: '+123456789',
      email: 'supplier@example.test',
    })
    expect(await purchases.listSuppliers(ownerId, 'Updated')).toMatchObject([
      { id: supplierId, name: 'Updated Local Supplier' },
    ])
    const purchaseId = await purchases.createPurchase(ownerId, {
      warehouseId,
      supplierId,
      supplierInvoiceNumber: 'EXT-2026-01',
      items: [
        { productId, unitId, quantity: '10', unitCost: '3', discount: '2' },
      ],
    })
    let purchase = await purchases.getPurchase(ownerId, purchaseId)
    expect(purchase).toMatchObject({
      invoiceNumber: 'PUR-000001',
      supplierInvoiceNumber: 'EXT-2026-01',
      status: 'draft',
      subtotal: '30',
      discountTotal: '2',
      total: '28',
      outstandingBalance: '0',
    })
    await expect(
      inventory.getBalance(ownerId, warehouseId, productId),
    ).rejects.toThrow(/selected warehouse/)
    await expect(
      purchases.addSupplierPayment(ownerId, purchaseId, {
        amount: '1',
        method: 'cash',
      }),
    ).rejects.toThrow(/received purchases/)

    await purchases.receiveGoods(ownerId, purchaseId)
    purchase = await purchases.getPurchase(ownerId, purchaseId)
    expect(purchase.status).toBe('received')
    expect(purchase.receivedAt).toBeTruthy()
    expect(purchase.items).toMatchObject([{ quantity: '10', unitCost: '3' }])
    expect(
      (await inventory.getBalance(ownerId, warehouseId, productId)).quantity,
    ).toBe('10')
    await purchases.addSupplierPayment(ownerId, purchaseId, {
      amount: '8',
      method: 'bank_transfer',
      reference: 'BANK-1',
    })
    purchase = await purchases.getPurchase(ownerId, purchaseId)
    expect(purchase).toMatchObject({
      paidTotal: '8',
      outstandingBalance: '20',
      payments: [{ amount: '8', method: 'bank_transfer', reference: 'BANK-1' }],
    })
    await expect(
      purchases.addSupplierPayment(ownerId, purchaseId, {
        amount: '21',
        method: 'cash',
      }),
    ).rejects.toThrow(/cannot exceed/)

    const statement = await purchases.getSupplierStatement(
      ownerId,
      supplierId,
      branchId,
    )
    expect(statement).toMatchObject({
      totalPurchases: '28',
      totalPayments: '8',
      totalReturns: '0',
      balanceDue: '20',
      entries: [
        { type: 'purchase', amount: '28', balance: '28' },
        { type: 'payment', amount: '-8', balance: '20' },
      ],
    })
    expect(await purchases.listPurchases(ownerId, { branchId })).toHaveLength(1)
  })

  it('supports product-specific purchase units and increases stock only in base units upon receipt', async () => {
    const carton = (await catalog.listUnits(ownerId)).find((unit) => unit.code === 'CTN')
    if (!carton) {
      throw new Error('The carton test unit was not initialized')
    }
    const cartonProduct = await catalog.createProduct(ownerId, {
      sku: 'CARTON-PURCHASE',
      name: 'Carton purchase product',
      baseUnitId: unitId,
      purchasePrice: '5',
      sellingPrice: '10',
      minimumStock: '0',
      conversions: [{ unitId: carton.id, factorToBase: '4' }],
    }, branchId)
    const purchaseId = await purchases.createPurchase(ownerId, {
      warehouseId,
      supplierId,
      items: [{
        productId: cartonProduct,
        unitId: carton.id,
        quantity: '2',
        unitCost: '20',
      }],
    })
    await purchases.receiveGoods(ownerId, purchaseId)
    expect(
      (await inventory.getBalance(ownerId, warehouseId, cartonProduct)).quantity,
    ).toBe('8')
    expect(
      (await inventory.getBalance(ownerId, warehouseId, cartonProduct)).averageUnitCost,
    ).toBe('5')
  })

  it('records partial supplier returns as credits and restores liability without changing payment history', async () => {
    const purchaseId = await purchases.createPurchase(ownerId, {
      warehouseId,
      supplierId,
      items: [{ productId, unitId, quantity: '10', unitCost: '3' }],
    })
    await purchases.receiveGoods(ownerId, purchaseId)
    await purchases.addSupplierPayment(ownerId, purchaseId, {
      amount: '10',
      method: 'cash',
    })
    const purchase = await purchases.getPurchase(ownerId, purchaseId)
    const itemId = purchase.items[0]!.id
    const returnId = await purchases.returnPurchase(ownerId, purchaseId, {
      reason: 'Defective items',
      items: [{ purchaseItemId: itemId, quantity: '2' }],
    })
    const updated = await purchases.getPurchase(ownerId, purchaseId)
    expect(updated).toMatchObject({
      status: 'partially_returned',
      paidTotal: '10',
      returnedTotal: '6',
      outstandingBalance: '14',
      returns: [{
        id: returnId,
        refundTotal: '6',
        items: [{ quantity: '2', refundAmount: '6' }],
      }],
      items: [{ returnedQuantity: '2' }],
    })
    expect(
      (await inventory.getBalance(ownerId, warehouseId, productId)).quantity,
    ).toBe('8')
    expect(
      await database.query(
        `SELECT movement_type, unit_cost FROM inventory_movements
         WHERE source_type = 'purchase_return' AND source_id = ?`,
        [returnId],
      ),
    ).toEqual([{ movement_type: 'purchase_return_out', unit_cost: '3' }])
    const statement = await purchases.getSupplierStatement(
      ownerId,
      supplierId,
      branchId,
    )
    expect(statement).toMatchObject({
      totalPurchases: '30',
      totalPayments: '10',
      totalReturns: '6',
      balanceDue: '14',
    })
    await expect(
      purchases.returnPurchase(ownerId, purchaseId, {
        reason: 'Return more than purchased',
        items: [{ purchaseItemId: itemId, quantity: '9' }],
      }),
    ).rejects.toThrow(/exceeds the unreturned purchased quantity/)
    await purchases.returnPurchase(ownerId, purchaseId, {
      reason: 'Return remaining items',
      items: [{ purchaseItemId: itemId, quantity: '8' }],
    })
    expect((await purchases.getPurchase(ownerId, purchaseId)).status).toBe('returned')
    await expect(
      purchases.archiveSupplier(ownerId, supplierId),
    ).rejects.toThrow(/outstanding balance or credit/)
  })

  it('rolls back return documents when available stock is insufficient', async () => {
    const purchaseId = await purchases.createPurchase(ownerId, {
      warehouseId,
      supplierId,
      items: [{ productId, unitId, quantity: '5', unitCost: '3' }],
    })
    await purchases.receiveGoods(ownerId, purchaseId)
    await inventory.adjustStock(ownerId, {
      productId,
      warehouseId,
      unitId,
      quantity: '5',
      direction: 'out',
      reason: 'Sold before the supplier return',
    })
    const purchase = await purchases.getPurchase(ownerId, purchaseId)
    await expect(
      purchases.returnPurchase(ownerId, purchaseId, {
        reason: 'Return stock that is no longer available',
        items: [{ purchaseItemId: purchase.items[0]!.id, quantity: '1' }],
      }),
    ).rejects.toThrow(/Insufficient stock/)
    expect(
      await database.query('SELECT id FROM purchase_returns'),
    ).toEqual([])
    expect((await purchases.getPurchase(ownerId, purchaseId)).status).toBe('received')
  })

  it('requires supplier and purchasing permissions and prevents archiving with balances', async () => {
    const readerId = await createPurchasesUser('purchasereader', ['purchases.read'])
    await expect(
      purchases.createPurchase(readerId, {
        warehouseId,
        supplierId,
        items: [{ productId, unitId, quantity: '1', unitCost: '3' }],
      }),
    ).rejects.toThrow(AuthorizationError)
    const branchOnlyId = await createPurchasesUser('branchonlybuyer', [
      'purchases.create',
    ], [])
    await expect(
      purchases.createPurchase(branchOnlyId, {
        warehouseId,
        supplierId,
        items: [{ productId, unitId, quantity: '1', unitCost: '3' }],
      }),
    ).rejects.toThrow(AuthorizationError)
    await expect(purchases.createSupplier(readerId, {
      code: 'UNAUTH',
      name: 'Unauthorized',
    })).rejects.toThrow(AuthorizationError)

    const purchaseId = await purchases.createPurchase(ownerId, {
      warehouseId,
      supplierId,
      items: [{ productId, unitId, quantity: '1', unitCost: '3' }],
    })
    await purchases.receiveGoods(ownerId, purchaseId)
    await expect(
      purchases.archiveSupplier(ownerId, supplierId),
    ).rejects.toThrow(/outstanding balance/)
    await purchases.addSupplierPayment(ownerId, purchaseId, {
      amount: '3',
      method: 'cash',
    })
    await purchases.archiveSupplier(ownerId, supplierId)
    expect(await purchases.listSuppliers(ownerId)).toMatchObject([
      { id: supplierId, status: 'archived' },
    ])
    await expect(
      purchases.createPurchase(ownerId, {
        warehouseId,
        supplierId,
        items: [{ productId, unitId, quantity: '1', unitCost: '3' }],
      }),
    ).rejects.toThrow(/inactive/)
  })

  it('rejects invalid quantities, units, suppliers, and duplicate product lines', async () => {
    await expect(
      purchases.createPurchase(ownerId, {
        warehouseId,
        supplierId,
        items: [
          { productId, unitId, quantity: '1', unitCost: '3' },
          { productId, unitId, quantity: '2', unitCost: '3' },
        ],
      }),
    ).rejects.toThrow(/only once/)
    await expect(
      purchases.createPurchase(ownerId, {
        warehouseId,
        supplierId,
        items: [{ productId, unitId, quantity: '0', unitCost: '3' }],
      }),
    ).rejects.toThrow(PurchasesError)
    await expect(
      purchases.createPurchase(ownerId, {
        warehouseId,
        supplierId: '00000000-0000-4000-8000-000000000000',
        items: [{ productId, unitId, quantity: '1', unitCost: '3' }],
      }),
    ).rejects.toThrow(/supplier/)
  })
})
