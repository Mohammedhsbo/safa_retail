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
import { SalesService } from '../sales/SalesService'
import { AccountingError } from './accounting.errors'
import { AccountingService } from './AccountingService'

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
let productId: string
let unitId: string
let authentication: AuthenticationService
let catalog: ProductCatalogService
let inventory: InventoryService
let organization: OrganizationService
let sales: SalesService
let accounting: AccountingService
let passwordHasher: PasswordHasher

async function createAccountingUser(
  username: string,
  permissions: PermissionCode[],
  branchIds: string[] = [branchId],
): Promise<string> {
  const roles = new RoleManagementService(database)
  const roleId = await roles.createRole(ownerId, `${username} role`)
  await roles.setPermissions(ownerId, roleId, permissions)
  const role = (await new AuthRepository(database).getRoles()).find(
    (item) => item.id === roleId,
  )
  if (!role) {
    throw new Error('The accounting test role was not created')
  }
  return new UserManagementService(database, passwordHasher).createUser(
    ownerId,
    {
      username,
      displayName: username,
      password: 'a-secure-accounting-password',
      roleCodes: [role.code],
      branchIds,
      warehouseIds: [],
    },
  )
}

async function createSale(customerId: string, amount: string): Promise<string> {
  await inventory.adjustStock(ownerId, {
    productId,
    warehouseId,
    unitId,
    quantity: amount,
    direction: 'in',
    unitCost: '1',
    reason: 'Opening stock for accounting test',
  })
  return sales.createSale(ownerId, {
    warehouseId,
    customerId,
    items: [{ productId, unitId, quantity: amount }],
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
  sales = new SalesService(database)
  accounting = new AccountingService(database)
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
    code: 'finance',
    name: 'Finance Branch',
  })
  warehouseId = await organization.createWarehouse(ownerId, {
    branchId,
    code: 'main',
    name: 'Main Warehouse',
    warehouseType: 'fabrics',
  })
  productId = await catalog.createProduct(ownerId, {
    sku: 'ACCOUNTING-ITEM',
    name: 'Accounting Item',
    baseUnitId: unitId,
    purchasePrice: '1',
    sellingPrice: '10',
    minimumStock: '0',
  }, branchId)
})

afterEach(async () => {
  await database.close()
})

describe('customer accounts and cash management', () => {
  it('manages customers, applies collections to credit invoices, and reports running balances', async () => {
    const customerId = await accounting.createCustomer(ownerId, {
      code: 'cus-001',
      name: 'Account Customer',
      phone: '+123456789',
      email: 'account@example.test',
    })
    await accounting.updateCustomer(ownerId, customerId, {
      code: 'cus-001',
      name: 'Updated Account Customer',
      phone: '+123456789',
      email: 'account@example.test',
    })
    expect(await accounting.listCustomers(ownerId, 'Updated')).toMatchObject([
      { id: customerId, name: 'Updated Account Customer' },
    ])
    const cashboxId = await accounting.createCashbox(ownerId, {
      branchId,
      code: 'CASH',
      name: 'Main cash account',
    })
    const saleId = await createSale(customerId, '3')
    const sale = await sales.getSale(ownerId, saleId)
    expect(sale.outstandingBalance).toBe('30')
    await expect(
      accounting.recordCustomerCollection(ownerId, {
        saleId,
        cashboxId,
        amount: '31',
        method: 'cash',
      }),
    ).rejects.toThrow(/cannot exceed/)
    const paymentId = await accounting.recordCustomerCollection(ownerId, {
      saleId,
      cashboxId,
      amount: '12',
      method: 'bank_transfer',
      reference: 'BANK-12',
    })
    expect(await sales.getSale(ownerId, saleId)).toMatchObject({
      amountPaid: '12',
      outstandingBalance: '18',
      payments: [{ amount: '12', method: 'bank_transfer' }],
    })
    expect(await accounting.listCashboxes(ownerId, branchId)).toMatchObject([
      { id: cashboxId, balance: '12' },
    ])
    expect(await accounting.getCashboxMovements(ownerId, cashboxId)).toMatchObject([
      {
        movementType: 'receipt',
        amount: '12',
        sourceType: 'customer_collection',
        sourceId: paymentId,
      },
    ])
    const statement = await accounting.getCustomerStatement(
      ownerId,
      customerId,
      branchId,
    )
    expect(statement).toMatchObject({
      totalInvoiced: '30',
      totalReturned: '0',
      totalCollected: '12',
      totalRefunded: '0',
      balanceDue: '18',
      customerCredit: '0',
      entries: [
        { type: 'sale', amount: '30', balance: '30' },
        { type: 'collection', amount: '-12', balance: '18' },
      ],
    })
    await expect(accounting.archiveCustomer(ownerId, customerId)).rejects.toThrow(
      /outstanding balance or credit/,
    )
  })

  it('applies returns and collections to customer liability before archiving the account', async () => {
    const customerId = await accounting.createCustomer(ownerId, {
      code: 'CUS-RETURN',
      name: 'Return Customer',
    })
    const cashboxId = await accounting.createCashbox(ownerId, {
      branchId,
      code: 'RETURN',
      name: 'Return collections',
    })
    const saleId = await createSale(customerId, '2')
    const sale = await sales.getSale(ownerId, saleId)
    await sales.returnSale(ownerId, saleId, {
      reason: 'One item returned',
      items: [{ saleItemId: sale.items[0]!.id, quantity: '1' }],
    })
    let statement = await accounting.getCustomerStatement(
      ownerId,
      customerId,
      branchId,
    )
    expect(statement).toMatchObject({
      totalInvoiced: '20',
      totalReturned: '10',
      balanceDue: '10',
    })
    await accounting.recordCustomerCollection(ownerId, {
      saleId,
      cashboxId,
      amount: '10',
      method: 'cash',
    })
    statement = await accounting.getCustomerStatement(ownerId, customerId, branchId)
    expect(statement).toMatchObject({
      totalCollected: '10',
      balanceDue: '0',
      customerCredit: '0',
    })
    await accounting.archiveCustomer(ownerId, customerId)
    expect(await accounting.listCustomers(ownerId)).toMatchObject([
      { id: customerId, status: 'archived' },
    ])
  })

  it('posts receipts, disbursements, expenses, and balanced transfers atomically', async () => {
    const cashboxId = await accounting.createCashbox(ownerId, {
      branchId,
      code: 'TILL',
      name: 'Till',
    })
    const bankboxId = await accounting.createCashbox(ownerId, {
      branchId,
      code: 'BANK',
      name: 'Bank',
    })
    await expect(
      accounting.recordCashDisbursement(ownerId, {
        cashboxId,
        amount: '1',
        description: 'Insufficient funds',
      }),
    ).rejects.toThrow(/insufficient funds/)
    const receiptId = await accounting.recordCashReceipt(ownerId, {
      cashboxId,
      amount: '100',
      description: 'Opening receipt',
    })
    expect(await database.query(
      `SELECT action, entity_id, after_data FROM audit_logs
       WHERE entity_type = 'cash_movement' AND entity_id = ?`,
      [receiptId],
    )).toMatchObject([
      {
        action: 'cashbox.received',
        entity_id: receiptId,
        after_data: expect.stringContaining('Opening receipt'),
      },
    ])
    await expect(
      database.run('UPDATE cash_movements SET amount = ? WHERE source_id = ?', ['1', receiptId]),
    ).rejects.toThrow(/immutable/)
    const expenseId = await accounting.createExpense(ownerId, {
      branchId,
      cashboxId,
      category: 'utilities',
      amount: '20',
      description: 'Monthly utility bill',
    })
    await accounting.recordCashDisbursement(ownerId, {
      cashboxId,
      amount: '10',
      description: 'Petty cash disbursement',
    })
    const transferId = await accounting.transferCash(ownerId, {
      fromCashboxId: cashboxId,
      toCashboxId: bankboxId,
      amount: '30',
      description: 'Move till funds to bank',
    })
    expect(await accounting.listCashboxes(ownerId, branchId)).toMatchObject([
      { id: bankboxId, balance: '30' },
      { id: cashboxId, balance: '40' },
    ])
    expect(await accounting.listExpenses(ownerId, branchId)).toMatchObject([
      {
        id: expenseId,
        category: 'utilities',
        amount: '20',
        status: 'posted',
      },
    ])
    const transferMovements = await database.query(
      `SELECT movement_type, cashbox_id, amount FROM cash_movements
       WHERE source_type = 'cash_transfer' AND source_id = ? ORDER BY movement_type`,
      [transferId],
    )
    expect(transferMovements).toEqual([
      { movement_type: 'transfer_in', cashbox_id: bankboxId, amount: '30' },
      { movement_type: 'transfer_out', cashbox_id: cashboxId, amount: '30' },
    ])
    expect(
      await database.query(
        'SELECT id FROM expenses WHERE id = ? AND status = ?',
        [expenseId, 'posted'],
      ),
    ).toHaveLength(1)
    await expect(accounting.archiveCashbox(ownerId, cashboxId)).rejects.toThrow(
      /non-zero balance/,
    )
  })

  it('enforces permissions and branch scope for financial reads and writes', async () => {
    const customerId = await accounting.createCustomer(ownerId, {
      code: 'SCOPE-01',
      name: 'Scope Customer',
    })
    const cashboxId = await accounting.createCashbox(ownerId, {
      branchId,
      code: 'SCOPE',
      name: 'Scoped cashbox',
    })
    const noAccounting = await createAccountingUser('noaccounting', ['sales.read'])
    await expect(
      accounting.createCashbox(noAccounting, {
        branchId,
        code: 'DENIED',
        name: 'Denied',
      }),
    ).rejects.toThrow(AuthorizationError)
    const unassigned = await createAccountingUser(
      'unassigned',
      ['accounting.read', 'accounting.manage'],
      [],
    )
    await expect(
      accounting.listCashboxes(unassigned, branchId),
    ).rejects.toThrow(AuthorizationError)
    const saleId = await createSale(customerId, '1')
    await expect(
      accounting.recordCustomerCollection(noAccounting, {
        saleId,
        cashboxId,
        amount: '1',
        method: 'cash',
      }),
    ).rejects.toThrow(AuthorizationError)
  })

  it('rejects invalid customer, cash, transfer, and expense inputs without partial records', async () => {
    await expect(
      accounting.createCustomer(ownerId, {
        code: 'x',
        name: '',
      }),
    ).rejects.toThrow(AccountingError)
    const cashboxId = await accounting.createCashbox(ownerId, {
      branchId,
      code: 'VALID',
      name: 'Valid cashbox',
    })
    await expect(
      accounting.transferCash(ownerId, {
        fromCashboxId: cashboxId,
        toCashboxId: cashboxId,
        amount: '1',
        description: 'Same cashbox',
      }),
    ).rejects.toThrow(AccountingError)
    await expect(
      accounting.createExpense(ownerId, {
        branchId,
        cashboxId,
        category: 'supplies',
        amount: '0',
        description: 'Zero expense',
      }),
    ).rejects.toThrow(AccountingError)
    expect(await database.query('SELECT id FROM expenses')).toEqual([])
    expect(await database.query('SELECT id FROM cash_movements')).toEqual([])
  })
})
