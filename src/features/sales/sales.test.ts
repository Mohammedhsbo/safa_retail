// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../../infrastructure/database/setup'
import { SqliteDatabase } from '../../infrastructure/database/SqliteDatabase'
import { createUuid } from '../../infrastructure/database/uuid'
import { BetterSqliteTestDriver } from '../../test/database/BetterSqliteTestDriver'
import { AuthRepository } from '../auth/AuthRepository'
import { AuthenticationService } from '../auth/AuthenticationService'
import { AuthorizationError } from '../auth/auth.errors'
import { RoleManagementService } from '../auth/RoleManagementService'
import { UserManagementService } from '../auth/UserManagementService'
import type { PermissionCode, PasswordHasher } from '../auth/auth.types'
import { ProductCatalogService } from '../catalog/ProductCatalogService'
import { InventoryService } from '../inventory/InventoryService'
import { OrganizationService } from '../organization/OrganizationService'
import { SalesService } from './SalesService'

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
let customerId: string
let productId: string
let unitId: string
let authentication: AuthenticationService
let catalog: ProductCatalogService
let inventory: InventoryService
let organization: OrganizationService
let sales: SalesService
let passwordHasher: PasswordHasher

async function createSalesUser(
  username: string,
  permissions: PermissionCode[],
): Promise<string> {
  const roles = new RoleManagementService(database)
  const roleId = await roles.createRole(ownerId, `${username} role`)
  await roles.setPermissions(ownerId, roleId, permissions)
  const role = (await new AuthRepository(database).getRoles()).find(
    (item) => item.id === roleId,
  )
  if (!role) {
    throw new Error('The sales test role was not created')
  }
  return new UserManagementService(database, passwordHasher).createUser(
    ownerId,
    {
      username,
      displayName: username,
      password: 'a-secure-sales-password',
      roleCodes: [role.code],
      branchIds: [branchId],
      warehouseIds: [warehouseId],
    },
  )
}

async function createCustomer(): Promise<string> {
  const id = createUuid()
  const now = new Date().toISOString()
  await database.run(
    `INSERT INTO customers
       (id, code, name, phone, email, address, notes, status, created_at, updated_at)
     VALUES (?, 'CUS-001', 'Retail Customer', NULL, NULL, NULL, NULL, 'active', ?, ?)`,
    [id, now, now],
  )
  return id
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
  sales = new SalesService(database)
  const owner = await authentication.setupInitialOwner({
    username: 'owner',
    displayName: 'Owner',
    password: 'a-secure-owner-password',
  })
  ownerId = owner.id
  await catalog.initializeStandardUnits(ownerId)
  const units = Object.fromEntries(
    (await catalog.listUnits(ownerId)).map((unit) => [unit.code, unit.id]),
  )
  unitId = units.PC!
  branchId = await organization.createBranch(ownerId, {
    code: 'sales',
    name: 'Sales Branch',
  })
  warehouseId = await organization.createWarehouse(ownerId, {
    branchId,
    code: 'main',
    name: 'Main Warehouse',
  })
  productId = await catalog.createProduct(ownerId, {
    sku: 'SALE-ITEM',
    name: 'Sale Item',
    baseUnitId: unitId,
    purchasePrice: '4',
    sellingPrice: '10',
    minimumStock: '0',
    barcodes: [{ barcode: '0123456789', unitId }],
  })
  customerId = await createCustomer()
  await inventory.adjustStock(ownerId, {
    productId,
    warehouseId,
    unitId,
    quantity: '20',
    direction: 'in',
    unitCost: '4',
    reason: 'Opening stock',
  })
})

afterEach(async () => {
  await database.close()
})

describe('sales and offline POS services', () => {
  it('searches by barcode and posts a discounted, taxed, partially paid invoice atomically', async () => {
    await expect(
      sales.getTaxConfiguration(ownerId, branchId),
    ).resolves.toEqual({
      branchId,
      taxRate: '0',
      taxMode: 'exclusive',
    })
    await sales.setTaxConfiguration(ownerId, {
      branchId,
      taxRate: '10',
      taxMode: 'exclusive',
    })
    const [product] = await sales.searchProducts(ownerId, {
      warehouseId,
      query: '0123456789',
    })
    expect(product).toMatchObject({
      id: productId,
      barcode: '0123456789',
      stock: '20',
      sellingPrice: '10',
    })
    const saleId = await sales.createSale(ownerId, {
      warehouseId,
      customerId,
      items: [{
        productId,
        unitId,
        quantity: '2',
        discount: '2',
      }],
      payments: [{ amount: '10', method: 'cash', reference: 'till 1' }],
    })
    const sale = await sales.getSale(ownerId, saleId)
    expect(sale).toMatchObject({
      invoiceNumber: 'INV-000001',
      status: 'posted',
      subtotal: '20',
      discountTotal: '2',
      taxTotal: '1.8',
      taxRate: '10',
      taxMode: 'exclusive',
      total: '19.8',
      amountPaid: '10',
      outstandingBalance: '9.8',
      customerName: 'Retail Customer',
      items: [{ quantity: '2', lineTotal: '19.8' }],
      payments: [{ amount: '10', method: 'cash', reference: 'till 1' }],
    })
    await sales.setTaxConfiguration(ownerId, {
      branchId,
      taxRate: '15',
      taxMode: 'inclusive',
    })
    expect((await sales.getSale(ownerId, saleId)).taxRate).toBe('10')
    expect(
      (await inventory.getBalance(ownerId, warehouseId, productId)).quantity,
    ).toBe('18')
    expect(
      await database.query(
        `SELECT movement_type, source_type, source_id
         FROM inventory_movements WHERE source_type = 'sale' AND source_id = ?`,
        [saleId],
      ),
    ).toEqual([{
      movement_type: 'sale_out',
      source_type: 'sale',
      source_id: saleId,
    }])
    expect(
      await database.query(
        `SELECT action FROM audit_logs WHERE entity_type = 'sale' AND entity_id = ?`,
        [saleId],
      ),
    ).toEqual([{ action: 'sale.posted' }])
  })

  it('extracts inclusive tax and requires discount authorization for edited prices', async () => {
    const sellerId = await createSalesUser('seller', [
      'sales.create',
      'sales.read',
    ])
    await sales.setTaxConfiguration(ownerId, {
      branchId,
      taxRate: '10',
      taxMode: 'inclusive',
    })
    await expect(
      sales.createSale(sellerId, {
        warehouseId,
        customerId,
        items: [{ productId, unitId, quantity: '1', unitPrice: '11' }],
        payments: [{ amount: '11', method: 'card' }],
      }),
    ).rejects.toThrow(AuthorizationError)
    const saleId = await sales.createSale(sellerId, {
      warehouseId,
      customerId,
      items: [{ productId, unitId, quantity: '1' }],
      payments: [{ amount: '10', method: 'cash' }],
    })
    const sale = await sales.getSale(sellerId, saleId)
    expect(sale).toMatchObject({
      subtotal: '10',
      taxTotal: '0.909090909',
      total: '10',
    })
  })

  it('converts selected units to base stock and derives the default price for that unit', async () => {
    const carton = (await catalog.listUnits(ownerId)).find(
      (unit) => unit.code === 'CTN',
    )
    if (!carton) {
      throw new Error('The carton test unit was not initialized')
    }
    const boxedProductId = await catalog.createProduct(ownerId, {
      sku: 'SALE-BOX',
      name: 'Boxed item',
      baseUnitId: unitId,
      purchasePrice: '4',
      sellingPrice: '10',
      minimumStock: '0',
      conversions: [{ unitId: carton.id, factorToBase: '3' }],
    })
    await inventory.adjustStock(ownerId, {
      productId: boxedProductId,
      warehouseId,
      unitId,
      quantity: '12',
      direction: 'in',
      unitCost: '4',
      reason: 'Opening boxed stock',
    })
    const saleId = await sales.createSale(ownerId, {
      warehouseId,
      items: [{
        productId: boxedProductId,
        unitId: carton.id,
        quantity: '2',
      }],
      payments: [{ amount: '60', method: 'cash' }],
    })
    const sale = await sales.getSale(ownerId, saleId)
    expect(sale.items).toMatchObject([
      { quantity: '2', unitPrice: '30', lineTotal: '60' },
    ])
    expect(
      (await inventory.getBalance(ownerId, warehouseId, boxedProductId)).quantity,
    ).toBe('6')
  })

  it('requires a customer for credit and rolls back invoices when stock posting fails', async () => {
    await expect(
      sales.createSale(ownerId, {
        warehouseId,
        items: [{ productId, unitId, quantity: '1' }],
      }),
    ).rejects.toThrow(/customer is required/)
    await expect(
      sales.createSale(ownerId, {
        warehouseId,
        customerId,
        items: [{ productId, unitId, quantity: '21' }],
        payments: [{ amount: '210', method: 'cash' }],
      }),
    ).rejects.toThrow(/Insufficient stock/)
    expect(
      await database.query('SELECT id FROM sales'),
    ).toEqual([])
    expect(
      await database.query('SELECT id FROM sale_items'),
    ).toEqual([])
  })

  it('processes partial returns and cash refunds without exceeding sold quantity', async () => {
    const sellerId = await createSalesUser('returnseller', [
      'sales.create',
      'sales.read',
      'sales.returns',
    ])
    const saleId = await sales.createSale(sellerId, {
      warehouseId,
      customerId,
      items: [{ productId, unitId, quantity: '2', unitPrice: '10' }],
      payments: [{ amount: '20', method: 'cash' }],
    })
    const sale = await sales.getSale(sellerId, saleId)
    const saleItemId = sale.items[0]!.id
    const returnId = await sales.returnSale(sellerId, saleId, {
      reason: 'Customer returned one',
      items: [{ saleItemId, quantity: '1' }],
      refundAmount: '5',
      refundMethod: 'cash',
    })
    let updated = await sales.getSale(sellerId, saleId)
    expect(updated).toMatchObject({
      status: 'partially_returned',
      returnedTotal: '10',
      amountPaid: '15',
      amountRefunded: '5',
      outstandingBalance: '0',
      customerCredit: '5',
      returns: [{
        id: returnId,
        refundTotal: '10',
        items: [{
          productId,
          sku: 'SALE-ITEM',
          productName: 'Sale Item',
          quantity: '1',
          refundAmount: '10',
        }],
      }],
    })
    expect(
      (await inventory.getBalance(ownerId, warehouseId, productId)).quantity,
    ).toBe('19')
    await expect(
      sales.returnSale(sellerId, saleId, {
        reason: 'Excess return',
        items: [{ saleItemId, quantity: '2' }],
      }),
    ).rejects.toThrow(/exceeds the unreturned quantity/)
    await sales.returnSale(sellerId, saleId, {
      reason: 'Remaining item',
      items: [{ saleItemId, quantity: '1' }],
    })
    updated = await sales.getSale(sellerId, saleId)
    expect(updated.status).toBe('returned')
    expect(updated.returnedTotal).toBe('20')
    expect(
      (await inventory.getBalance(ownerId, warehouseId, productId)).quantity,
    ).toBe('20')
  })

  it('cancels a sale by recording stock and payment reversals instead of deleting history', async () => {
    const saleId = await sales.createSale(ownerId, {
      warehouseId,
      customerId,
      items: [{ productId, unitId, quantity: '3' }],
      payments: [{ amount: '30', method: 'card' }],
    })
    await sales.cancelSale(ownerId, saleId)
    const sale = await sales.getSale(ownerId, saleId)
    expect(sale).toMatchObject({
      status: 'cancelled',
      amountPaid: '0',
      amountRefunded: '30',
      outstandingBalance: '0',
      payments: [
        { amount: '30', method: 'card' },
        { amount: '-30', method: 'refund_card' },
      ],
    })
    expect(
      (await inventory.getBalance(ownerId, warehouseId, productId)).quantity,
    ).toBe('20')
    expect(
      await database.query(
        `SELECT movement_type FROM inventory_movements
         WHERE source_type = 'sale_cancellation' AND source_id = ?`,
        [saleId],
      ),
    ).toEqual([{ movement_type: 'sale_cancel_in' }])
  })

  it('enforces sales permissions and location scope on product search and history', async () => {
    const noAccess = await createSalesUser('nosales', ['sales.read'])
    await expect(
      sales.searchProducts(noAccess, { warehouseId, query: 'SALE' }),
    ).rejects.toThrow(AuthorizationError)
    await expect(
      sales.listSales(noAccess, { branchId }),
    ).resolves.toEqual([])
    const saleId = await sales.createSale(ownerId, {
      warehouseId,
      customerId,
      items: [{ productId, unitId, quantity: '1' }],
      payments: [{ amount: '10', method: 'cash' }],
    })
    await expect(sales.getSale(noAccess, saleId)).resolves.toMatchObject({
      id: saleId,
    })
  })
})
