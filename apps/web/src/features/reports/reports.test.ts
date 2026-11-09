// @vitest-environment node
import { createHash } from 'node:crypto'
import { strFromU8, unzipSync } from 'fflate'
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
import type { PasswordHasher } from '../auth/auth.types'
import { ProductCatalogService } from '../catalog/ProductCatalogService'
import { InventoryService } from '../inventory/InventoryService'
import { ManufacturingService } from '../manufacturing/ManufacturingService'
import { OrganizationService } from '../organization/OrganizationService'
import { SalesService } from '../sales/SalesService'
import { ReportsError } from './reports.errors'
import { ReportsService } from './ReportsService'

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
let otherBranchId: string
let warehouseId: string
let productId: string
let unitId: string
let customerId: string
let supplierId: string
let saleId: string
let authentication: AuthenticationService
let catalog: ProductCatalogService
let inventory: InventoryService
let organization: OrganizationService
let sales: SalesService
let manufacturing: ManufacturingService
let reports: ReportsService
let passwordHasher: PasswordHasher
let reportDate: string

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
  manufacturing = new ManufacturingService(database)
  reports = new ReportsService(database)
  ownerId = (await authentication.setupInitialOwner({
    username: 'owner',
    displayName: 'Owner',
    password: 'a-secure-owner-password',
  })).id
  await catalog.initializeStandardUnits(ownerId)
  unitId = Object.fromEntries(
    (await catalog.listUnits(ownerId)).map((unit) => [unit.code, unit.id]),
  ).PC!
  branchId = await organization.createBranch(ownerId, {
    code: 'north',
    name: 'North Branch',
  })
  warehouseId = await organization.createWarehouse(ownerId, {
    branchId,
    code: 'main',
    name: 'Main Warehouse',
    warehouseType: 'fabrics',
  })
  otherBranchId = await organization.createBranch(ownerId, {
    code: 'south',
    name: 'South Branch',
  })
  await organization.createWarehouse(ownerId, {
    branchId: otherBranchId,
    code: 'main',
    name: 'South Warehouse',
    warehouseType: 'fabrics',
  })
  productId = await catalog.createProduct(ownerId, {
    sku: 'REPORT-ITEM',
    name: 'Report Item',
    baseUnitId: unitId,
    purchasePrice: '4',
    sellingPrice: '10',
    minimumStock: '18',
  }, branchId)
  const now = new Date().toISOString()
  reportDate = now.slice(0, 10)
  customerId = createUuid()
  supplierId = createUuid()
  await database.run(
    `INSERT INTO customers
       (id, code, name, status, created_at, updated_at)
     VALUES (?, 'CUS-REPORT', 'Report Customer', 'active', ?, ?)`,
    [customerId, now, now],
  )
  await database.run(
    `INSERT INTO suppliers
       (id, code, name, status, created_at, updated_at)
     VALUES (?, 'SUP-REPORT', 'Report Supplier', 'active', ?, ?)`,
    [supplierId, now, now],
  )
  await inventory.adjustStock(ownerId, {
    productId,
    warehouseId,
    unitId,
    quantity: '20',
    direction: 'in',
    unitCost: '4',
    reason: 'Opening stock',
  })
  await sales.setTaxConfiguration(ownerId, {
    branchId,
    taxRate: '10',
    taxMode: 'exclusive',
  })
  saleId = await sales.createSale(ownerId, {
    warehouseId,
    customerId,
    items: [{ productId, unitId, quantity: '2' }],
    payments: [{ amount: '15', method: 'cash' }],
  })
  const purchaseId = createUuid()
  await database.run(
    `INSERT INTO purchases
       (id, branch_id, warehouse_id, supplier_id, invoice_number, status,
        subtotal, discount_total, tax_total, total, notes, created_by,
        received_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'PUR-REPORT', 'received',
             '30', '0', '0', '30', NULL, ?, ?, ?, ?)`,
    [purchaseId, branchId, warehouseId, supplierId, ownerId, now, now, now],
  )
  await database.run(
    `INSERT INTO purchase_payments
       (id, purchase_id, amount, payment_method, reference, paid_by, paid_at, created_at)
     VALUES (?, ?, '5', 'cash', NULL, ?, ?, ?)`,
    [createUuid(), purchaseId, ownerId, now, now],
  )
  await database.run(
    `INSERT INTO expenses
       (id, branch_id, category, amount, description, status, incurred_at,
        created_by, created_at, updated_at)
     VALUES (?, ?, 'rent', '3', 'Monthly rent', 'posted', ?, ?, ?, ?)`,
    [createUuid(), branchId, now, ownerId, now, now],
  )
})

afterEach(async () => {
  await database.close()
})

describe('business reports', () => {
  it('calculates decimal-safe reports, account balances, and current stock within branch scope', async () => {
    const report = await reports.getReports(ownerId, {
      fromDate: reportDate,
      toDate: reportDate,
      branchId,
    })

    expect(report.summary).toMatchObject({
      grossSales: '22',
      salesReturns: '0',
      netSales: '22',
      netRevenueExcludingTax: '20',
      netSalesTax: '2',
      netPurchases: '30',
      costOfGoodsSold: '8',
      grossProfit: '12',
      expenses: '3',
      netProfit: '9',
      inventoryValueCurrent: '72',
      lowStockProductCount: '1',
      customerReceivables: '7',
      supplierPayables: '25',
    })
    expect(report.salesAnalytics).toContainEqual(expect.objectContaining({
      branch: 'North Branch',
      grossSales: '22',
      salesTax: '2',
      collections: '15',
      costOfGoodsSold: '8',
      grossProfit: '12',
    }))
    expect(report.purchaseAnalytics).toContainEqual(expect.objectContaining({
      branch: 'North Branch',
      grossPurchases: '30',
      netPurchases: '30',
    }))
    expect(report.customerBalances).toEqual([expect.objectContaining({
      code: 'CUS-REPORT',
      amountDue: '7',
      customerCredit: '0',
    })])
    expect(report.supplierBalances).toEqual([expect.objectContaining({
      code: 'SUP-REPORT',
      amountPayable: '25',
      supplierCredit: '0',
    })])
    expect(report.lowStockReport).toEqual([expect.objectContaining({
      branch: 'North Branch',
      sku: 'REPORT-ITEM',
      quantity: '18',
      minimumStock: '18',
      inventoryValue: '72',
      warehouseTypes: 'fabrics',
    })])
    expect(report.branches).toEqual([expect.objectContaining({ id: branchId })])
  })

  it('rejects invalid date ranges and enforces reports permission and branch access', async () => {
    await expect(reports.getReports(ownerId, {
      fromDate: '2026-02-30',
      toDate: '2026-03-01',
    })).rejects.toBeInstanceOf(ReportsError)
    await expect(reports.getReports(ownerId, {
      fromDate: '2026-03-02',
      toDate: '2026-03-01',
    })).rejects.toBeInstanceOf(ReportsError)

    const roles = new RoleManagementService(database)
    const roleId = await roles.createRole(ownerId, 'Reports reader')
    await roles.setPermissions(ownerId, roleId, ['reports.read'])
    const role = (await new AuthRepository(database).getRoles()).find(
      (item) => item.id === roleId,
    )
    if (!role) throw new Error('The reports test role was not created')
    const readerId = await new UserManagementService(
      database,
      passwordHasher,
    ).createUser(ownerId, {
      username: 'report-reader',
      displayName: 'Report Reader',
      password: 'a-secure-report-password',
      roleCodes: [role.code],
      branchIds: [branchId],
      warehouseIds: [warehouseId],
    })
    const report = await reports.getReports(readerId, {
      fromDate: reportDate,
      toDate: reportDate,
    })
    expect(report.branches.map((branch) => branch.id)).toEqual([branchId])
    await expect(reports.getReports(readerId, {
      fromDate: reportDate,
      toDate: reportDate,
      branchId: otherBranchId,
    })).rejects.toBeInstanceOf(AuthorizationError)

    const noReportsRoleId = await roles.createRole(ownerId, 'No reports reader')
    await roles.setPermissions(ownerId, noReportsRoleId, ['products.read'])
    const noReportsRole = (await new AuthRepository(database).getRoles()).find(
      (item) => item.id === noReportsRoleId,
    )
    if (!noReportsRole) throw new Error('The no-reports test role was not created')
    const noReportsUserId = await new UserManagementService(
      database,
      passwordHasher,
    ).createUser(ownerId, {
      username: 'no-report-reader',
      displayName: 'No Report Reader',
      password: 'a-secure-report-password',
      roleCodes: [noReportsRole.code],
      branchIds: [branchId],
      warehouseIds: [warehouseId],
    })
    await expect(reports.getReports(noReportsUserId, {
      fromDate: reportDate,
      toDate: reportDate,
    })).rejects.toBeInstanceOf(AuthorizationError)
  })

  it('accounts for return tax, returned inventory cost, and cash refunds', async () => {
    const sale = await sales.getSale(ownerId, saleId)
    const saleItem = sale.items[0]
    if (!saleItem) throw new Error('The report sale item was not created')
    await sales.returnSale(ownerId, saleId, {
      reason: 'Customer return',
      items: [{ saleItemId: saleItem.id, quantity: '1' }],
      refundAmount: '11',
      refundMethod: 'cash',
    })

    const report = await reports.getReports(ownerId, {
      fromDate: reportDate,
      toDate: reportDate,
      branchId,
    })
    expect(report.summary).toMatchObject({
      salesReturns: '11',
      netSales: '11',
      netRevenueExcludingTax: '10',
      netSalesTax: '1',
      costOfGoodsSold: '4',
      grossProfit: '6',
      customerReceivables: '7',
      inventoryValueCurrent: '76',
      lowStockProductCount: '0',
    })
    expect(report.salesAnalytics).toContainEqual(expect.objectContaining({
      returns: '11',
      returnedTax: '1',
      collections: '4',
      costOfGoodsSold: '4',
      grossProfit: '6',
    }))
  })

  it('reverses cancelled invoice revenue, tax, collections, and inventory cost', async () => {
    const cancelledSaleId = await sales.createSale(ownerId, {
      warehouseId,
      items: [{ productId, unitId, quantity: '1' }],
      payments: [{ amount: '11', method: 'cash' }],
    })
    await sales.cancelSale(ownerId, cancelledSaleId)

    const report = await reports.getReports(ownerId, {
      fromDate: reportDate,
      toDate: reportDate,
      branchId,
    })
    expect(report.summary).toMatchObject({
      grossSales: '33',
      salesCancellations: '11',
      netSales: '22',
      netRevenueExcludingTax: '20',
      netSalesTax: '2',
      netCollections: '15',
      costOfGoodsSold: '8',
      grossProfit: '12',
    })
    expect(report.salesAnalytics).toContainEqual(expect.objectContaining({
      grossSales: '33',
      cancellations: '11',
      cancelledTax: '1',
      netSales: '22',
      collections: '15',
      costOfGoodsSold: '8',
      grossProfit: '12',
    }))
  })

  it('keeps post-period cancellations out of customer balances as of the report end date', async () => {
    const saleId = await sales.createSale(ownerId, {
      warehouseId,
      customerId,
      items: [{ productId, unitId, quantity: '1' }],
    })
    const priorDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const priorTimestamp = priorDate.toISOString()
    const priorDateOnly = priorTimestamp.slice(0, 10)
    await database.run(
      'UPDATE sales SET created_at = ?, updated_at = ? WHERE id = ?',
      [priorTimestamp, priorTimestamp, saleId],
    )
    await sales.cancelSale(ownerId, saleId)

    const report = await reports.getReports(ownerId, {
      fromDate: priorDateOnly,
      toDate: priorDateOnly,
      branchId,
    })
    expect(report.summary.customerReceivables).toBe('11')
    expect(report.customerBalances).toContainEqual(expect.objectContaining({
      code: 'CUS-REPORT',
      amountDue: '11',
    }))
  })

  it('reports completed manufacturing output, waste, and absorbed costs', async () => {
    const rawMaterialId = await catalog.createProduct(ownerId, {
      sku: 'RAW-REPORT',
      name: 'Raw Report Material',
      baseUnitId: unitId,
      purchasePrice: '4',
      sellingPrice: '5',
      minimumStock: '0',
    }, branchId)
    await inventory.adjustStock(ownerId, {
      productId: rawMaterialId,
      warehouseId,
      unitId,
      quantity: '5',
      direction: 'in',
      unitCost: '4',
      reason: 'Opening raw material',
    })
    const orderId = await manufacturing.createOrder(ownerId, {
      warehouseId,
      finishedProductId: productId,
      plannedQuantity: '2',
      materials: [{
        productId: rawMaterialId,
        unitId,
        plannedQuantity: '2',
      }],
    })
    await manufacturing.planOrder(ownerId, orderId)
    await manufacturing.startOrder(ownerId, orderId)
    const order = await manufacturing.getOrder(ownerId, orderId)
    const material = order.materials[0]
    if (!material) throw new Error('The manufacturing material was not created')
    await manufacturing.consumeMaterials(ownerId, orderId, {
      materials: [{ materialId: material.id, quantity: '2' }],
    })
    await manufacturing.addProductionCost(ownerId, orderId, {
      costType: 'labor',
      amount: '2',
      description: 'Report test labor',
    })
    await manufacturing.completeOrder(ownerId, orderId, {
      actualQuantity: '1',
      wasteQuantity: '1',
    })

    const report = await reports.getReports(ownerId, {
      fromDate: reportDate,
      toDate: reportDate,
      branchId,
    })
    expect(report.summary).toMatchObject({
      completedProductionOrders: '1',
      actualProductionOutput: '1',
      productionWaste: '1',
      productionCost: '10',
    })
    expect(report.manufacturingReport).toContainEqual(expect.objectContaining({
      productSku: 'REPORT-ITEM',
      plannedQuantity: '2',
      actualQuantity: '1',
      wasteQuantity: '1',
      materialCost: '8',
      additionalCost: '2',
      totalCost: '10',
    }))
  })

  it('exports report values as a valid XLSX workbook and PDF document', async () => {
    const input = {
      fromDate: reportDate,
      toDate: reportDate,
      branchId,
    }
    const workbook = await reports.exportExcel(ownerId, input)
    const files = unzipSync(workbook)
    expect(Object.keys(files)).toContain('xl/workbook.xml')
    const workbookXml = strFromU8(files['xl/workbook.xml'] ?? new Uint8Array())
    expect(workbookXml).toContain('Sales analytics')
    const salesSheet = strFromU8(
      files['xl/worksheets/sheet2.xml'] ?? new Uint8Array(),
    )
    expect(salesSheet).toContain('22')

    const pdf = await reports.exportPdf(ownerId, input)
    expect(new TextDecoder().decode(pdf.slice(0, 8))).toContain('%PDF-')
  })
})
