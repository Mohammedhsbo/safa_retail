import { z } from 'zod'
import { createUuid } from '../../infrastructure/database/uuid'
import type { SqlDatabase } from '../../infrastructure/database/types'
import type { SqlExecutor, SqlRow } from '../../infrastructure/database/types'
import { AccessControlService } from '../auth/AccessControlService'
import { AuthRepository } from '../auth/AuthRepository'
import { formatDecimal, parseDecimal } from '../inventory/decimal'
import { AccountingError } from './accounting.errors'
import { AccountingRepository } from './AccountingRepository'

const uuidSchema = z.string().uuid()
const decimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/)
const customerSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
})
const customerSearchSchema = z.string().trim().max(128)
const cashboxSchema = z.object({
  branchId: uuidSchema,
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/),
  name: z.string().trim().min(1).max(120),
})
const cashEntrySchema = z.object({
  cashboxId: uuidSchema,
  amount: decimalSchema,
  description: z.string().trim().min(2).max(500),
})
const transferSchema = z.object({
  fromCashboxId: uuidSchema,
  toCashboxId: uuidSchema,
  amount: decimalSchema,
  description: z.string().trim().min(2).max(500),
})
const collectionSchema = z.object({
  saleId: uuidSchema,
  cashboxId: uuidSchema,
  amount: decimalSchema,
  method: z.enum(['cash', 'card', 'bank_transfer', 'mobile', 'other']),
  reference: z.string().trim().max(200).nullable().optional(),
})
const expenseSchema = z.object({
  branchId: uuidSchema,
  cashboxId: uuidSchema,
  category: z.string().trim().min(1).max(80),
  amount: decimalSchema,
  description: z.string().trim().min(2).max(500),
  incurredAt: z.string().datetime({ offset: true }).optional(),
})

export type Customer = {
  id: string
  code: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export type CustomerStatement = {
  customer: Customer
  branchId: string
  totalInvoiced: string
  totalReturned: string
  totalCollected: string
  totalRefunded: string
  balanceDue: string
  customerCredit: string
  entries: Array<{
    id: string
    type: 'sale' | 'return' | 'collection' | 'refund'
    reference: string
    description: string
    amount: string
    occurredAt: string
    balance: string
  }>
}

export type Cashbox = {
  id: string
  branchId: string
  branchName: string
  code: string
  name: string
  status: string
  balance: string
  createdAt: string
  updatedAt: string
}

export type CashMovement = {
  id: string
  movementType: string
  amount: string
  sourceType: string
  sourceId: string
  occurredAt: string
}

export type Expense = {
  id: string
  branchId: string
  category: string
  amount: string
  description: string
  status: string
  incurredAt: string
  createdAt: string
}

export class AccountingService {
  private readonly database: SqlDatabase
  private readonly access: AccessControlService
  private readonly authRepository: AuthRepository
  private readonly repository: AccountingRepository

  constructor(database: SqlDatabase) {
    this.database = database
    this.access = new AccessControlService(database)
    this.authRepository = new AuthRepository(database)
    this.repository = new AccountingRepository(database)
  }

  async listCustomers(actorId: string, search = ''): Promise<Customer[]> {
    await this.access.assertPermission(actorId, 'customers.manage')
    const parsedSearch = customerSearchSchema.safeParse(search)
    if (!parsedSearch.success) {
      throw new AccountingError('The customer search is invalid')
    }
    return (await this.repository.listCustomers(parsedSearch.data)).map((row) =>
      this.mapCustomer(row),
    )
  }

  async createCustomer(actorId: string, input: unknown): Promise<string> {
    const parsed = customerSchema.safeParse(input)
    if (!parsed.success) {
      throw new AccountingError('The customer details are invalid')
    }
    const id = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'customers.manage', transaction)
      await this.repository.createCustomer({
        id,
        code: parsed.data.code,
        name: parsed.data.name,
        phone: parsed.data.phone ?? null,
        email: parsed.data.email ?? null,
        address: parsed.data.address ?? null,
        notes: parsed.data.notes ?? null,
        createdAt: now,
      }, transaction)
      await this.writeAudit(
        transaction,
        actorId,
        'customer.created',
        'customer',
        id,
        null,
        parsed.data,
        now,
      )
    })
    return id
  }

  async updateCustomer(
    actorId: string,
    customerId: string,
    input: unknown,
  ): Promise<void> {
    const parsed = customerSchema.safeParse(input)
    if (!parsed.success || !uuidSchema.safeParse(customerId).success) {
      throw new AccountingError('The customer details are invalid')
    }
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'customers.manage', transaction)
      const before = await this.repository.getCustomer(customerId, transaction)
      if (!before || before.status !== 'active') {
        throw new AccountingError('The active customer does not exist')
      }
      await this.repository.updateCustomer(customerId, {
        code: parsed.data.code,
        name: parsed.data.name,
        phone: parsed.data.phone ?? null,
        email: parsed.data.email ?? null,
        address: parsed.data.address ?? null,
        notes: parsed.data.notes ?? null,
      }, now, transaction)
      await this.writeAudit(
        transaction,
        actorId,
        'customer.updated',
        'customer',
        customerId,
        this.auditRow(before),
        parsed.data,
        now,
      )
    })
  }

  async archiveCustomer(actorId: string, customerId: string): Promise<void> {
    if (!uuidSchema.safeParse(customerId).success) {
      throw new AccountingError('The customer identifier is invalid')
    }
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'customers.manage', transaction)
      const customer = await this.repository.getCustomer(customerId, transaction)
      if (!customer || customer.status !== 'active') {
        throw new AccountingError('The active customer does not exist')
      }
      const sales = await transaction.query(
        `SELECT id, branch_id, status, total FROM sales
         WHERE customer_id = ? AND status IN ('posted', 'partially_returned', 'returned')`,
        [customerId],
      )
      let totalBalance = 0n
      for (const sale of sales) {
        totalBalance += await this.saleBalance(sale, transaction)
      }
      if (totalBalance !== 0n) {
        throw new AccountingError(
          'A customer with an outstanding balance or credit cannot be archived',
        )
      }
      await this.repository.archiveCustomer(customerId, now, transaction)
      await this.writeAudit(
        transaction,
        actorId,
        'customer.archived',
        'customer',
        customerId,
        { status: 'active' },
        { status: 'archived' },
        now,
      )
    })
  }

  async getCustomerStatement(
    actorId: string,
    customerId: string,
    branchId: string,
  ): Promise<CustomerStatement> {
    await this.assertBranchPermission(actorId, 'accounting.read', branchId)
    if (!uuidSchema.safeParse(customerId).success) {
      throw new AccountingError('The customer identifier is invalid')
    }
    const customerRow = await this.repository.getCustomer(customerId)
    if (!customerRow) {
      throw new AccountingError('The customer does not exist')
    }
    const customer = this.mapCustomer(customerRow)
    const [sales, returns, payments] = await Promise.all([
      this.repository.listCustomerSales(customerId, branchId),
      this.repository.listCustomerReturns(customerId, branchId),
      this.repository.listCustomerPayments(customerId, branchId),
    ])
    const entries: CustomerStatement['entries'] = []
    for (const sale of sales) {
      if (!this.isPostedSale(sale.status)) continue
      const invoiceNumber = this.rowString(sale.invoice_number)
      entries.push({
        id: this.rowString(sale.id),
        type: 'sale',
        reference: invoiceNumber,
        description: `Invoice ${invoiceNumber}`,
        amount: this.rowString(sale.total),
        occurredAt: this.rowString(sale.created_at),
        balance: '',
      })
    }
    for (const returned of returns) {
      entries.push({
        id: this.rowString(returned.id),
        type: 'return',
        reference: this.rowString(returned.return_number),
        description: this.rowString(returned.reason),
        amount: formatDecimal(-parseDecimal(this.rowString(returned.refund_total), 'Return value')),
        occurredAt: this.rowString(returned.created_at),
        balance: '',
      })
    }
    for (const payment of payments) {
      if (!this.isPostedSale(payment.sale_status)) continue
      const amount = parseSignedDecimal(this.rowString(payment.amount), 'Customer payment')
      const refund = amount < 0n
      const reference =
        typeof payment.reference === 'string'
          ? payment.reference
          : this.rowString(payment.invoice_number)
      entries.push({
        id: this.rowString(payment.id),
        type: refund ? 'refund' : 'collection',
        reference,
        description: refund
          ? `Refund for ${this.rowString(payment.invoice_number)}`
          : `${this.rowString(payment.payment_method)} collection`,
        amount: formatDecimal(-amount),
        occurredAt: this.rowString(payment.paid_at),
        balance: '',
      })
    }
    const entryOrder: Record<CustomerStatement['entries'][number]['type'], number> = {
      sale: 0,
      return: 1,
      collection: 2,
      refund: 3,
    }
    entries.sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      entryOrder[left.type] - entryOrder[right.type] ||
      left.id.localeCompare(right.id),
    )
    let balance = 0n
    let totalInvoiced = 0n
    let totalReturned = 0n
    let totalCollected = 0n
    let totalRefunded = 0n
    for (const entry of entries) {
      const amount = parseSignedDecimal(entry.amount, 'Statement amount')
      balance += amount
      if (entry.type === 'sale') totalInvoiced += amount
      if (entry.type === 'return') totalReturned -= amount
      if (entry.type === 'collection') totalCollected -= amount
      if (entry.type === 'refund') totalRefunded += amount
      entry.balance = formatDecimal(balance)
    }
    return {
      customer,
      branchId,
      totalInvoiced: formatDecimal(totalInvoiced),
      totalReturned: formatDecimal(totalReturned),
      totalCollected: formatDecimal(totalCollected),
      totalRefunded: formatDecimal(totalRefunded),
      balanceDue: formatDecimal(balance > 0n ? balance : 0n),
      customerCredit: formatDecimal(balance < 0n ? -balance : 0n),
      entries,
    }
  }

  async recordCustomerCollection(
    actorId: string,
    input: unknown,
  ): Promise<string> {
    const parsed = collectionSchema.safeParse(input)
    if (!parsed.success || parseDecimal(parsed.data.amount, 'Collection amount') <= 0n) {
      throw new AccountingError('The customer collection details are invalid')
    }
    const paymentId = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'accounting.manage', transaction)
      const sale = await this.repository.getSale(parsed.data.saleId, transaction)
      if (
        !sale ||
        !this.isPostedSale(sale.status) ||
        typeof sale.customer_id !== 'string'
      ) {
        throw new AccountingError('Only an active customer invoice can receive a collection')
      }
      await this.assertBranchAccess(actorId, this.rowString(sale.branch_id), transaction)
      const cashbox = await this.requireActiveCashbox(
        parsed.data.cashboxId,
        transaction,
      )
      if (cashbox.branch_id !== sale.branch_id) {
        throw new AccountingError('The cashbox must belong to the invoice branch')
      }
      const amount = parseDecimal(parsed.data.amount, 'Collection amount')
      const due = await this.saleBalance(sale, transaction)
      if (due <= 0n || amount > due) {
        throw new AccountingError('Collection cannot exceed the customer balance due')
      }
      await this.repository.addSalePayment({
        id: paymentId,
        saleId: parsed.data.saleId,
        amount: formatDecimal(amount),
        paymentMethod: parsed.data.method,
        reference: parsed.data.reference ?? null,
        actorId,
        paidAt: now,
      }, transaction)
      await this.addMovement(
        transaction,
        actorId,
        cashbox,
        'receipt',
        amount,
        'customer_collection',
        paymentId,
        now,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'customer.collection_recorded',
        'sale_payment',
        paymentId,
        null,
        {
          saleId: parsed.data.saleId,
          customerId: sale.customer_id,
          cashboxId: parsed.data.cashboxId,
          amount: formatDecimal(amount),
          method: parsed.data.method,
        },
        now,
      )
    })
    return paymentId
  }

  async createCashbox(actorId: string, input: unknown): Promise<string> {
    const parsed = cashboxSchema.safeParse(input)
    if (!parsed.success) {
      throw new AccountingError('The cashbox details are invalid')
    }
    const id = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'accounting.manage', transaction)
      await this.assertBranchAccess(actorId, parsed.data.branchId, transaction)
      const [branch] = await transaction.query(
        "SELECT id FROM branches WHERE id = ? AND status = 'active'",
        [parsed.data.branchId],
      )
      if (!branch) {
        throw new AccountingError('The active branch does not exist')
      }
      await this.repository.createCashbox({
        id,
        branchId: parsed.data.branchId,
        code: parsed.data.code,
        name: parsed.data.name,
        createdAt: now,
      }, transaction)
      await this.writeAudit(
        transaction,
        actorId,
        'cashbox.created',
        'cashbox',
        id,
        null,
        parsed.data,
        now,
      )
    })
    return id
  }

  async listCashboxes(actorId: string, branchId: string): Promise<Cashbox[]> {
    await this.assertBranchPermission(actorId, 'accounting.read', branchId)
    const rows = await this.repository.listCashboxes(branchId)
    const cashboxes: Cashbox[] = []
    for (const row of rows) {
      const cashbox = this.mapCashbox(row)
      cashboxes.push({
        ...cashbox,
        balance: formatDecimal(await this.cashboxBalance(cashbox.id, this.database)),
      })
    }
    return cashboxes
  }

  async getCashboxMovements(
    actorId: string,
    cashboxId: string,
  ): Promise<CashMovement[]> {
    if (!uuidSchema.safeParse(cashboxId).success) {
      throw new AccountingError('The cashbox identifier is invalid')
    }
    const cashbox = await this.repository.getCashbox(cashboxId)
    if (!cashbox || cashbox.branch_status !== 'active') {
      throw new AccountingError('The cashbox branch is inactive')
    }
    await this.assertBranchPermission(actorId, 'accounting.read', this.rowString(cashbox.branch_id))
    return (await this.repository.listCashMovements(cashboxId)).map((row) => ({
      id: this.rowString(row.id),
      movementType: this.rowString(row.movement_type),
      amount: this.rowString(row.amount),
      sourceType: this.rowString(row.source_type),
      sourceId: this.rowString(row.source_id),
      occurredAt: this.rowString(row.occurred_at),
    }))
  }

  async archiveCashbox(actorId: string, cashboxId: string): Promise<void> {
    if (!uuidSchema.safeParse(cashboxId).success) {
      throw new AccountingError('The cashbox identifier is invalid')
    }
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'accounting.manage', transaction)
      const cashbox = await this.requireActiveCashbox(cashboxId, transaction)
      await this.assertBranchAccess(actorId, this.rowString(cashbox.branch_id), transaction)
      if ((await this.cashboxBalance(cashboxId, transaction)) !== 0n) {
        throw new AccountingError('A cashbox with a non-zero balance cannot be archived')
      }
      await this.repository.archiveCashbox(cashboxId, now, transaction)
      await this.writeAudit(
        transaction,
        actorId,
        'cashbox.archived',
        'cashbox',
        cashboxId,
        { status: 'active' },
        { status: 'archived' },
        now,
      )
    })
  }

  async recordCashReceipt(actorId: string, input: unknown): Promise<string> {
    return this.recordManualCashEntry(actorId, input, 'receipt')
  }

  async recordCashDisbursement(actorId: string, input: unknown): Promise<string> {
    return this.recordManualCashEntry(actorId, input, 'disbursement')
  }

  async transferCash(actorId: string, input: unknown): Promise<string> {
    const parsed = transferSchema.safeParse(input)
    if (
      !parsed.success ||
      parsed.data.fromCashboxId === parsed.data.toCashboxId ||
      parseDecimal(parsed.data.amount, 'Transfer amount') <= 0n
    ) {
      throw new AccountingError('The cash transfer details are invalid')
    }
    const transferId = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'accounting.manage', transaction)
      const source = await this.requireActiveCashbox(parsed.data.fromCashboxId, transaction)
      const destination = await this.requireActiveCashbox(parsed.data.toCashboxId, transaction)
      await this.assertBranchAccess(actorId, this.rowString(source.branch_id), transaction)
      await this.assertBranchAccess(actorId, this.rowString(destination.branch_id), transaction)
      const amount = parseDecimal(parsed.data.amount, 'Transfer amount')
      if ((await this.cashboxBalance(parsed.data.fromCashboxId, transaction)) < amount) {
        throw new AccountingError('The source cashbox has insufficient funds')
      }
      await this.addMovement(
        transaction,
        actorId,
        source,
        'transfer_out',
        amount,
        'cash_transfer',
        transferId,
        now,
      )
      await this.addMovement(
        transaction,
        actorId,
        destination,
        'transfer_in',
        amount,
        'cash_transfer',
        transferId,
        now,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'cashbox.transferred',
        'cash_transfer',
        transferId,
        null,
        {
          fromCashboxId: parsed.data.fromCashboxId,
          toCashboxId: parsed.data.toCashboxId,
          amount: formatDecimal(amount),
          description: parsed.data.description,
        },
        now,
      )
    })
    return transferId
  }

  async createExpense(actorId: string, input: unknown): Promise<string> {
    const parsed = expenseSchema.safeParse(input)
    if (!parsed.success || parseDecimal(parsed.data.amount, 'Expense amount') <= 0n) {
      throw new AccountingError('The expense details are invalid')
    }
    const expenseId = createUuid()
    const now = parsed.data.incurredAt ?? new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'accounting.manage', transaction)
      await this.assertBranchAccess(actorId, parsed.data.branchId, transaction)
      const cashbox = await this.requireActiveCashbox(
        parsed.data.cashboxId,
        transaction,
      )
      if (cashbox.branch_id !== parsed.data.branchId) {
        throw new AccountingError('The cashbox must belong to the expense branch')
      }
      const amount = parseDecimal(parsed.data.amount, 'Expense amount')
      if ((await this.cashboxBalance(parsed.data.cashboxId, transaction)) < amount) {
        throw new AccountingError('The cashbox has insufficient funds for this expense')
      }
      await this.repository.createExpense({
        id: expenseId,
        branchId: parsed.data.branchId,
        category: parsed.data.category,
        amount: formatDecimal(amount),
        description: parsed.data.description,
        actorId,
        occurredAt: now,
      }, transaction)
      await this.addMovement(
        transaction,
        actorId,
        cashbox,
        'disbursement',
        amount,
        'expense',
        expenseId,
        now,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'expense.posted',
        'expense',
        expenseId,
        null,
        {
          branchId: parsed.data.branchId,
          cashboxId: parsed.data.cashboxId,
          category: parsed.data.category,
          amount: formatDecimal(amount),
          description: parsed.data.description,
        },
        now,
      )
    })
    return expenseId
  }

  async listExpenses(actorId: string, branchId: string): Promise<Expense[]> {
    await this.assertBranchPermission(actorId, 'accounting.read', branchId)
    return (await this.repository.listExpenses(branchId)).map((row) => ({
      id: this.rowString(row.id),
      branchId: this.rowString(row.branch_id),
      category: this.rowString(row.category),
      amount: this.rowString(row.amount),
      description: this.rowString(row.description),
      status: this.rowString(row.status),
      incurredAt: this.rowString(row.incurred_at),
      createdAt: this.rowString(row.created_at),
    }))
  }

  private async recordManualCashEntry(
    actorId: string,
    input: unknown,
    movementType: 'receipt' | 'disbursement',
  ): Promise<string> {
    const parsed = cashEntrySchema.safeParse(input)
    if (!parsed.success || parseDecimal(parsed.data.amount, 'Cash amount') <= 0n) {
      throw new AccountingError('The cash movement details are invalid')
    }
    const movementId = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'accounting.manage', transaction)
      const cashbox = await this.requireActiveCashbox(parsed.data.cashboxId, transaction)
      await this.assertBranchAccess(actorId, this.rowString(cashbox.branch_id), transaction)
      const amount = parseDecimal(parsed.data.amount, 'Cash amount')
      if (
        movementType === 'disbursement' &&
        (await this.cashboxBalance(parsed.data.cashboxId, transaction)) < amount
      ) {
        throw new AccountingError('The cashbox has insufficient funds')
      }
      await this.addMovement(
        transaction,
        actorId,
        cashbox,
        movementType,
        amount,
        movementType === 'receipt' ? 'manual_receipt' : 'manual_disbursement',
        movementId,
        now,
        movementId,
      )
      await this.writeAudit(
        transaction,
        actorId,
        movementType === 'receipt' ? 'cashbox.received' : 'cashbox.disbursed',
        'cash_movement',
        movementId,
        null,
        {
          cashboxId: parsed.data.cashboxId,
          amount: formatDecimal(amount),
          description: parsed.data.description,
        },
        now,
      )
    })
    return movementId
  }

  private async addMovement(
    executor: SqlExecutor,
    actorId: string,
    cashbox: SqlRow,
    movementType: string,
    amount: bigint,
    sourceType: string,
    sourceId: string,
    occurredAt: string,
    movementId = createUuid(),
  ): Promise<string> {
    await this.repository.addCashMovement({
      id: movementId,
      cashboxId: this.rowString(cashbox.id),
      movementType,
      amount: formatDecimal(amount),
      sourceType,
      sourceId,
      actorId,
      occurredAt,
    }, executor)
    return movementId
  }

  private async requireActiveCashbox(
    cashboxId: string,
    executor: SqlExecutor,
  ): Promise<SqlRow> {
    if (!uuidSchema.safeParse(cashboxId).success) {
      throw new AccountingError('The cashbox identifier is invalid')
    }
    const cashbox = await this.repository.getCashbox(cashboxId, executor)
    if (
      !cashbox ||
      cashbox.status !== 'active' ||
      cashbox.branch_status !== 'active'
    ) {
      throw new AccountingError('The cashbox or its branch is inactive')
    }
    return cashbox
  }

  private async cashboxBalance(
    cashboxId: string,
    executor: SqlExecutor,
  ): Promise<bigint> {
    const rows = await this.repository.listCashMovements(cashboxId, executor)
    let balance = 0n
    for (const row of rows) {
      const amount = parseDecimal(this.rowString(row.amount), 'Cash movement amount')
      switch (this.rowString(row.movement_type)) {
        case 'receipt':
        case 'transfer_in':
          balance += amount
          break
        case 'disbursement':
        case 'transfer_out':
          balance -= amount
          break
        default:
          throw new AccountingError('A cash movement has an unsupported type')
      }
    }
    return balance
  }

  private async saleBalance(sale: SqlRow, executor: SqlExecutor): Promise<bigint> {
    const saleId = this.rowString(sale.id)
    const total = parseDecimal(this.rowString(sale.total), 'Invoice total')
    const [returns, payments] = await Promise.all([
      this.repository.listSaleReturns(saleId, executor),
      this.repository.listSalePayments(saleId, executor),
    ])
    const returned = returns.reduce(
      (sum, row) => sum + parseDecimal(this.rowString(row.refund_total), 'Return value'),
      0n,
    )
    const collected = payments.reduce(
      (sum, row) => sum + parseSignedDecimal(this.rowString(row.amount), 'Customer payment'),
      0n,
    )
    return total - returned - collected
  }

  private async assertBranchPermission(
    actorId: string,
    permission: 'accounting.read' | 'accounting.manage',
    branchId: string,
  ): Promise<void> {
    await this.access.assertPermission(actorId, permission)
    await this.assertBranchAccess(actorId, branchId, this.database)
  }

  private async assertBranchAccess(
    actorId: string,
    branchId: string,
    executor: SqlExecutor,
  ): Promise<void> {
    if (!uuidSchema.safeParse(branchId).success) {
      throw new AccountingError('The branch identifier is invalid')
    }
    await this.access.assertBranchAccess(actorId, branchId, executor)
  }

  private isPostedSale(status: unknown): boolean {
    return ['posted', 'partially_returned', 'returned'].includes(
      this.rowString(status),
    )
  }

  private mapCustomer(row: SqlRow): Customer {
    return {
      id: this.rowString(row.id),
      code: this.rowString(row.code),
      name: this.rowString(row.name),
      phone: typeof row.phone === 'string' ? row.phone : null,
      email: typeof row.email === 'string' ? row.email : null,
      address: typeof row.address === 'string' ? row.address : null,
      notes: typeof row.notes === 'string' ? row.notes : null,
      status: this.rowString(row.status),
      createdAt: this.rowString(row.created_at),
      updatedAt: this.rowString(row.updated_at),
    }
  }

  private mapCashbox(row: SqlRow): Cashbox {
    return {
      id: this.rowString(row.id),
      branchId: this.rowString(row.branch_id),
      branchName: this.rowString(row.branch_name),
      code: this.rowString(row.code),
      name: this.rowString(row.name),
      status: this.rowString(row.status),
      balance: '0',
      createdAt: this.rowString(row.created_at),
      updatedAt: this.rowString(row.updated_at),
    }
  }

  private async writeAudit(
    executor: SqlExecutor,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
    occurredAt: string,
  ): Promise<void> {
    await this.authRepository.writeAudit({
      actorUserId: actorId,
      action,
      entityType,
      entityId,
      beforeData: before === null ? null : JSON.stringify(before),
      afterData: after === null ? null : JSON.stringify(after),
      occurredAt,
    }, executor)
  }

  private auditRow(row: SqlRow): Record<string, string | number | null> {
    const result: Record<string, string | number | null> = {}
    for (const [key, value] of Object.entries(row)) {
      if (value === undefined || value instanceof Uint8Array) continue
      result[key] = value
    }
    return result
  }

  private rowString(value: unknown): string {
    if (typeof value !== 'string') {
      throw new AccountingError('An accounting record contains invalid data')
    }
    return value
  }
}

function parseSignedDecimal(value: string, field: string): bigint {
  return value.startsWith('-')
    ? -parseDecimal(value.slice(1), field)
    : parseDecimal(value, field)
}
