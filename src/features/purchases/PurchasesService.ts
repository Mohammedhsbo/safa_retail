import { z } from 'zod'
import { createUuid } from '../../infrastructure/database/uuid'
import type { SqlDatabase, SqlExecutor, SqlRow } from '../../infrastructure/database/types'
import { AccessControlService } from '../auth/AccessControlService'
import { AuthRepository } from '../auth/AuthRepository'
import { AuthorizationError } from '../auth/auth.errors'
import { InventoryService } from '../inventory/InventoryService'
import {
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  quantityWithinPrecision,
} from '../inventory/decimal'
import { PurchasesError } from './purchases.errors'
import { PurchasesRepository } from './PurchasesRepository'

const uuidSchema = z.string().uuid()
const decimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/)
const supplierSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
})
const purchaseInputSchema = z.object({
  warehouseId: uuidSchema,
  supplierId: uuidSchema,
  supplierInvoiceNumber: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  items: z.array(z.object({
    productId: uuidSchema,
    unitId: uuidSchema,
    quantity: decimalSchema,
    unitCost: decimalSchema,
    discount: decimalSchema.default('0'),
  })).min(1).max(500),
})
const paymentSchema = z.object({
  amount: decimalSchema,
  method: z.enum(['cash', 'card', 'bank_transfer', 'mobile', 'other']),
  reference: z.string().trim().max(200).nullable().optional(),
})
const historySchema = z.object({
  branchId: uuidSchema,
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).max(1_000_000).default(0),
})
const returnSchema = z.object({
  reason: z.string().trim().min(2).max(500),
  items: z.array(z.object({
    purchaseItemId: uuidSchema,
    quantity: decimalSchema,
  })).min(1).max(500),
})

export type Supplier = {
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

export type Purchase = {
  id: string
  branchId: string
  warehouseId: string
  supplierId: string
  supplierCode: string
  supplierName: string
  invoiceNumber: string
  supplierInvoiceNumber: string | null
  status: string
  subtotal: string
  discountTotal: string
  total: string
  paidTotal: string
  returnedTotal: string
  outstandingBalance: string
  supplierCredit: string
  notes: string | null
  createdAt: string
  receivedAt: string | null
  items: Array<{
    id: string
    productId: string
    sku: string
    productName: string
    unitId: string
    unitName: string
    quantity: string
    unitCost: string
    discountTotal: string
    lineTotal: string
    returnedQuantity: string
  }>
  payments: Array<{
    id: string
    amount: string
    method: string
    reference: string | null
    paidAt: string
  }>
  returns: Array<{
    id: string
    returnNumber: string
    reason: string
    refundTotal: string
    createdAt: string
    items: Array<{
      productId: string
      sku: string
      productName: string
      quantity: string
      refundAmount: string
    }>
  }>
}

export type SupplierStatement = {
  supplier: Supplier
  branchId: string
  totalPurchases: string
  totalPayments: string
  totalReturns: string
  balanceDue: string
  supplierCredit: string
  entries: Array<{
    id: string
    type: 'purchase' | 'payment' | 'return'
    reference: string
    description: string
    amount: string
    occurredAt: string
    balance: string
  }>
}

type CalculatedItem = {
  id: string
  productId: string
  unitId: string
  quantity: string
  unitCost: string
  discount: bigint
  gross: bigint
  lineTotal: bigint
}

export class PurchasesService {
  private readonly database: SqlDatabase
  private readonly access: AccessControlService
  private readonly authRepository: AuthRepository
  private readonly inventory: InventoryService
  private readonly repository: PurchasesRepository

  constructor(database: SqlDatabase) {
    this.database = database
    this.access = new AccessControlService(database)
    this.authRepository = new AuthRepository(database)
    this.inventory = new InventoryService(database)
    this.repository = new PurchasesRepository(database)
  }

  async listSuppliers(actorId: string, search = ''): Promise<Supplier[]> {
    await this.access.assertPermission(actorId, 'suppliers.manage')
    const parsedSearch = z.string().trim().max(128).safeParse(search)
    if (!parsedSearch.success) {
      throw new PurchasesError('The supplier search is invalid')
    }
    return (await this.repository.listSuppliers(parsedSearch.data)).map((row) =>
      this.mapSupplier(row),
    )
  }

  async createSupplier(actorId: string, input: unknown): Promise<string> {
    const parsed = supplierSchema.safeParse(input)
    if (!parsed.success) {
      throw new PurchasesError('The supplier details are invalid')
    }
    const id = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'suppliers.manage', transaction)
      await this.repository.createSupplier({
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
        'supplier.created',
        'supplier',
        id,
        null,
        parsed.data,
        now,
      )
    })
    return id
  }

  async updateSupplier(
    actorId: string,
    supplierId: string,
    input: unknown,
  ): Promise<void> {
    const parsed = supplierSchema.safeParse(input)
    if (!parsed.success || !uuidSchema.safeParse(supplierId).success) {
      throw new PurchasesError('The supplier details are invalid')
    }
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'suppliers.manage', transaction)
      const before = await this.repository.getSupplier(supplierId, transaction)
      if (!before || before.status !== 'active') {
        throw new PurchasesError('The active supplier does not exist')
      }
      await this.repository.updateSupplier(supplierId, {
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
        'supplier.updated',
        'supplier',
        supplierId,
        this.auditRow(before),
        parsed.data,
        now,
      )
    })
  }

  async archiveSupplier(actorId: string, supplierId: string): Promise<void> {
    if (!uuidSchema.safeParse(supplierId).success) {
      throw new PurchasesError('The supplier identifier is invalid')
    }
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'suppliers.manage', transaction)
      const supplier = await this.repository.getSupplier(supplierId, transaction)
      if (!supplier || supplier.status !== 'active') {
        throw new PurchasesError('The active supplier does not exist')
      }
      const purchases = await transaction.query(
        `SELECT id, total FROM purchases WHERE supplier_id = ?
         AND status IN ('received', 'partially_returned', 'returned')`,
        [supplierId],
      )
      let netLiability = 0n
      for (const purchase of purchases) {
        const total = parseDecimal(this.rowString(purchase.total), 'Purchase total')
        netLiability += total -
          (await this.purchaseReturnTotalForPurchase(purchase, transaction)) -
          (await this.purchasePaymentTotalForPurchase(purchase, transaction))
      }
      if (netLiability !== 0n) {
        throw new PurchasesError('A supplier with an outstanding balance or credit cannot be archived')
      }
      await this.repository.archiveSupplier(supplierId, now, transaction)
      await this.writeAudit(
        transaction,
        actorId,
        'supplier.archived',
        'supplier',
        supplierId,
        { status: 'active' },
        { status: 'archived' },
        now,
      )
    })
  }

  async createPurchase(actorId: string, input: unknown): Promise<string> {
    const parsed = purchaseInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new PurchasesError('The purchase invoice details are invalid')
    }
    if (
      new Set(parsed.data.items.map((item) => item.productId)).size !==
      parsed.data.items.length
    ) {
      throw new PurchasesError('A product may appear only once in a purchase invoice')
    }
    const purchaseId = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const location = await this.assertWarehousePermission(
        actorId,
        'purchases.create',
        parsed.data.warehouseId,
        transaction,
      )
      const supplier = await this.repository.getSupplier(parsed.data.supplierId, transaction)
      if (!supplier || supplier.status !== 'active') {
        throw new PurchasesError('The supplier does not exist or is inactive')
      }
      const items: CalculatedItem[] = []
      let subtotal = 0n
      let discountTotal = 0n
      let total = 0n
      for (const inputItem of parsed.data.items) {
        const product = await transaction.query(
          'SELECT id, status FROM products WHERE id = ?',
          [inputItem.productId],
        )
        if (!product[0] || product[0].status !== 'active') {
          throw new PurchasesError('A purchased product does not exist or is inactive')
        }
        const unit = await transaction.query(
          `SELECT u.decimal_places,
                  CASE WHEN u.id = p.base_unit_id THEN '1'
                       ELSE puc.factor_to_base END AS factor_to_base
           FROM products p JOIN measurement_units u ON u.id = ?
           LEFT JOIN product_unit_conversions puc
             ON puc.product_id = p.id AND puc.unit_id = u.id
           WHERE p.id = ? AND p.status = 'active' AND u.status = 'active'
             AND (u.id = p.base_unit_id OR puc.unit_id IS NOT NULL)`,
          [inputItem.unitId, inputItem.productId],
        )
        const selectedUnit = unit[0]
        if (!selectedUnit) {
          throw new PurchasesError('A purchase unit is inactive or not configured for the product')
        }
        const quantity = parseDecimal(inputItem.quantity, 'Purchase quantity')
        if (
          quantity <= 0n ||
          !quantityWithinPrecision(quantity, this.rowInteger(selectedUnit.decimal_places))
        ) {
          throw new PurchasesError('Purchase quantity is invalid for the selected unit')
        }
        const factor = parseDecimal(this.rowString(selectedUnit.factor_to_base), 'Unit conversion factor')
        const baseUnitRows = await transaction.query(
          `SELECT u.decimal_places FROM products p
           JOIN measurement_units u ON u.id = p.base_unit_id
           WHERE p.id = ?`,
          [inputItem.productId],
        )
        if (
          !baseUnitRows[0] ||
          !quantityWithinPrecision(
            multiplyDecimal(quantity, factor),
            this.rowInteger(baseUnitRows[0].decimal_places),
          )
        ) {
          throw new PurchasesError('Converted purchase quantity exceeds base unit precision')
        }
        const unitCost = parseDecimal(inputItem.unitCost, 'Purchase unit cost')
        const gross = multiplyDecimal(quantity, unitCost)
        const discount = parseDecimal(inputItem.discount, 'Purchase discount')
        if (discount > gross) {
          throw new PurchasesError('A purchase discount cannot exceed its line cost')
        }
        items.push({
          id: createUuid(),
          productId: inputItem.productId,
          unitId: inputItem.unitId,
          quantity: inputItem.quantity,
          unitCost: inputItem.unitCost,
          discount,
          gross,
          lineTotal: gross - discount,
        })
        subtotal += gross
        discountTotal += discount
        total += gross - discount
      }
      const count = await this.repository.countPurchasesForBranch(location.branchId, transaction)
      const invoiceNumber = `PUR-${String(count + 1).padStart(6, '0')}`
      const supplierInvoiceNumber = parsed.data.supplierInvoiceNumber?.trim() || null
      await this.repository.createPurchase({
        id: purchaseId,
        branchId: location.branchId,
        warehouseId: parsed.data.warehouseId,
        supplierId: parsed.data.supplierId,
        invoiceNumber,
        supplierInvoiceNumber,
        subtotal: formatDecimal(subtotal),
        discountTotal: formatDecimal(discountTotal),
        total: formatDecimal(total),
        notes: parsed.data.notes ?? null,
        actorId,
        createdAt: now,
      }, transaction)
      for (const item of items) {
        await this.repository.addPurchaseItem({
          id: item.id,
          purchaseId,
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          discountTotal: formatDecimal(item.discount),
          lineTotal: formatDecimal(item.lineTotal),
          createdAt: now,
        }, transaction)
      }
      await this.writeAudit(
        transaction,
        actorId,
        'purchase.draft_created',
        'purchase',
        purchaseId,
        null,
        {
          invoiceNumber,
          supplierId: parsed.data.supplierId,
          warehouseId: parsed.data.warehouseId,
          total: formatDecimal(total),
          itemCount: items.length,
        },
        now,
      )
    })
    return purchaseId
  }

  async receiveGoods(actorId: string, purchaseId: string): Promise<void> {
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const purchase = await this.requirePurchase(purchaseId, transaction)
      await this.assertWarehousePermission(
        actorId,
        'purchases.create',
        this.rowString(purchase.warehouse_id),
        transaction,
      )
      if (purchase.status !== 'draft') {
        throw new PurchasesError('Only draft purchases can be received')
      }
      const items = await this.repository.getPurchaseItems(purchaseId, transaction)
      if (items.length === 0) {
        throw new PurchasesError('The purchase invoice has no items')
      }
      await this.inventory.postPurchaseReceipt(
        actorId,
        this.rowString(purchase.warehouse_id),
        purchaseId,
        items.map((item) => ({
          productId: this.rowString(item.product_id),
          unitId: this.rowString(item.unit_id),
          quantity: this.rowString(item.quantity),
          unitCost: this.rowString(item.unit_cost),
        })),
        transaction,
      )
      await this.repository.receivePurchase(purchaseId, now, transaction)
      await this.writeAudit(
        transaction,
        actorId,
        'purchase.goods_received',
        'purchase',
        purchaseId,
        { status: purchase.status },
        { status: 'received', receivedAt: now },
        now,
      )
    })
  }

  async addSupplierPayment(
    actorId: string,
    purchaseId: string,
    input: unknown,
  ): Promise<string> {
    const parsed = paymentSchema.safeParse(input)
    if (!parsed.success || !uuidSchema.safeParse(purchaseId).success) {
      throw new PurchasesError('The supplier payment details are invalid')
    }
    const amount = parseDecimal(parsed.data.amount, 'Payment amount')
    if (amount <= 0n) {
      throw new PurchasesError('Payment amount must be greater than zero')
    }
    const paymentId = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const purchase = await this.requirePurchase(purchaseId, transaction)
      await this.assertWarehousePermission(
        actorId,
        'purchases.create',
        this.rowString(purchase.warehouse_id),
        transaction,
      )
      if (!['received', 'partially_returned', 'returned'].includes(this.rowString(purchase.status))) {
        throw new PurchasesError('Payments can be recorded only for received purchases')
      }
      const due = await this.getPurchaseBalance(purchase, transaction)
      if (amount > due) {
        throw new PurchasesError('Payment cannot exceed the supplier balance due')
      }
      await this.repository.addPayment({
        id: paymentId,
        purchaseId,
        amount: formatDecimal(amount),
        method: parsed.data.method,
        reference: parsed.data.reference ?? null,
        actorId,
        paidAt: now,
      }, transaction)
      await this.writeAudit(
        transaction,
        actorId,
        'supplier.payment_recorded',
        'purchase_payment',
        paymentId,
        null,
        { purchaseId, amount: formatDecimal(amount), method: parsed.data.method },
        now,
      )
    })
    return paymentId
  }

  async returnPurchase(
    actorId: string,
    purchaseId: string,
    input: unknown,
  ): Promise<string> {
    const parsed = returnSchema.safeParse(input)
    if (
      !parsed.success ||
      !uuidSchema.safeParse(purchaseId).success ||
      new Set(parsed.data.items.map((item) => item.purchaseItemId)).size !==
        parsed.data.items.length
    ) {
      throw new PurchasesError('The purchase return details are invalid')
    }
    const returnId = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const purchase = await this.requirePurchase(purchaseId, transaction)
      await this.assertWarehousePermission(
        actorId,
        'purchases.returns',
        this.rowString(purchase.warehouse_id),
        transaction,
      )
      if (!['received', 'partially_returned'].includes(this.rowString(purchase.status))) {
        throw new PurchasesError('Only received purchases can be returned')
      }
      const returnItems: Array<{
        purchaseItemId: string
        productId: string
        unitId: string
        quantity: string
        refundAmount: bigint
      }> = []
      let returnTotal = 0n
      for (const inputItem of parsed.data.items) {
        const purchaseItem = await this.repository.getPurchaseItem(
          inputItem.purchaseItemId,
          transaction,
        )
        if (!purchaseItem || purchaseItem.purchase_id !== purchaseId) {
          throw new PurchasesError('A selected item does not belong to this purchase')
        }
        const originalQuantity = parseDecimal(this.rowString(purchaseItem.quantity), 'Purchased quantity')
        const quantity = parseDecimal(inputItem.quantity, 'Return quantity')
        if (quantity <= 0n) {
          throw new PurchasesError('Return quantity must be greater than zero')
        }
        const priorReturns = await this.repository.listReturnsForPurchaseItem(
          inputItem.purchaseItemId,
          transaction,
        )
        const previouslyReturned = priorReturns.reduce(
          (sum, row) => sum + parseDecimal(this.rowString(row.quantity), 'Previously returned quantity'),
          0n,
        )
        if (previouslyReturned + quantity > originalQuantity) {
          throw new PurchasesError('Return quantity exceeds the unreturned purchased quantity')
        }
        const refundedValue = priorReturns.reduce(
          (sum, row) => sum + parseDecimal(this.rowString(row.refund_amount), 'Previously credited value'),
          0n,
        )
        const lineTotal = parseDecimal(this.rowString(purchaseItem.line_total), 'Purchase line total')
        const credit = previouslyReturned + quantity === originalQuantity
          ? lineTotal - refundedValue
          : divideDecimal(multiplyDecimal(lineTotal, quantity), originalQuantity)
        returnItems.push({
          purchaseItemId: inputItem.purchaseItemId,
          productId: this.rowString(purchaseItem.product_id),
          unitId: this.rowString(purchaseItem.unit_id),
          quantity: inputItem.quantity,
          refundAmount: credit,
        })
        returnTotal += credit
      }
      const returnNumber = `PR-${String(
        (await this.repository.countReturns(purchaseId, transaction)) + 1,
      ).padStart(4, '0')}`
      await this.repository.createReturn({
        id: returnId,
        purchaseId,
        returnNumber,
        reason: parsed.data.reason,
        refundTotal: formatDecimal(returnTotal),
        actorId,
        createdAt: now,
      }, transaction)
      for (const item of returnItems) {
        await this.repository.addReturnItem({
          id: createUuid(),
          returnId,
          purchaseItemId: item.purchaseItemId,
          quantity: item.quantity,
          refundAmount: formatDecimal(item.refundAmount),
          createdAt: now,
        }, transaction)
      }
      await this.inventory.postPurchaseReturnOutbound(
        actorId,
        this.rowString(purchase.warehouse_id),
        returnId,
        returnItems.map((item) => ({
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
        })),
        transaction,
      )
      const allItems = await this.repository.getPurchaseItems(purchaseId, transaction)
      let fullyReturned = true
      for (const item of allItems) {
        const prior = await this.repository.listReturnsForPurchaseItem(
          this.rowString(item.id),
          transaction,
        )
        const returned = prior.reduce(
          (sum, row) => sum + parseDecimal(this.rowString(row.quantity), 'Returned quantity'),
          0n,
        )
        if (returned < parseDecimal(this.rowString(item.quantity), 'Purchased quantity')) {
          fullyReturned = false
          break
        }
      }
      await this.repository.updatePurchaseStatus(
        purchaseId,
        fullyReturned ? 'returned' : 'partially_returned',
        now,
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'purchase.returned',
        'purchase_return',
        returnId,
        null,
        {
          purchaseId,
          returnNumber,
          reason: parsed.data.reason,
          supplierCredit: formatDecimal(returnTotal),
        },
        now,
      )
    })
    return returnId
  }

  async getPurchase(actorId: string, purchaseId: string): Promise<Purchase> {
    const purchase = await this.requirePurchase(purchaseId, this.database)
    await this.assertWarehouseScope(
      actorId,
      this.rowString(purchase.warehouse_id),
      this.database,
    )
    const principal = await this.authRepository.getPrincipal(actorId)
    if (!principal?.permissions.includes('purchases.read')) {
      throw new AuthorizationError('Permission required: purchases.read')
    }
    return this.mapPurchase(purchase, this.database)
  }

  async listPurchases(actorId: string, input: unknown): Promise<Purchase[]> {
    const parsed = historySchema.safeParse(input)
    if (!parsed.success) {
      throw new PurchasesError('The purchase history filter is invalid')
    }
    await this.access.assertPermission(actorId, 'purchases.read')
    await this.access.assertBranchAccess(actorId, parsed.data.branchId)
    const rows = await this.repository.listPurchases(
      parsed.data.branchId,
      parsed.data.limit,
      parsed.data.offset,
    )
    const purchases: Purchase[] = []
    for (const row of rows) {
      if (await this.canReadPurchase(actorId, row, this.database)) {
        purchases.push(await this.mapPurchase(row, this.database))
      }
    }
    return purchases
  }

  async getSupplierStatement(
    actorId: string,
    supplierId: string,
    branchId: string,
  ): Promise<SupplierStatement> {
    await this.access.assertPermission(actorId, 'purchases.read')
    await this.access.assertBranchAccess(actorId, branchId)
    const supplierRow = await this.repository.getSupplier(supplierId)
    if (!supplierRow) {
      throw new PurchasesError('The supplier does not exist')
    }
    const supplier = this.mapSupplier(supplierRow)
    const [purchases, returns, payments] = await Promise.all([
      this.repository.listStatementPurchases(supplierId, branchId),
      this.repository.listSupplierReturns(supplierId, branchId),
      this.repository.listSupplierPayments(supplierId, branchId),
    ])
    const entries: SupplierStatement['entries'] = []
    for (const purchase of purchases) {
      if (purchase.status === 'draft' || purchase.status === 'cancelled') continue
      entries.push({
        id: this.rowString(purchase.id),
        type: 'purchase',
        reference: this.rowString(purchase.invoice_number),
        description: `Purchase ${this.rowString(purchase.invoice_number)}`,
        amount: this.rowString(purchase.total),
        occurredAt: this.rowString(purchase.received_at),
        balance: '',
      })
    }
    for (const returned of returns) {
      entries.push({
        id: this.rowString(returned.id),
        type: 'return',
        reference: this.rowString(returned.return_number),
        description: this.rowString(returned.reason),
        amount: formatDecimal(-parseDecimal(this.rowString(returned.refund_total), 'Return credit')),
        occurredAt: this.rowString(returned.created_at),
        balance: '',
      })
    }
    for (const payment of payments) {
      entries.push({
        id: this.rowString(payment.id),
        type: 'payment',
        reference: this.rowString(payment.invoice_number),
        description: `${this.rowString(payment.payment_method)}${typeof payment.reference === 'string' ? ` · ${payment.reference}` : ''}`,
        amount: formatDecimal(-parseDecimal(this.rowString(payment.amount), 'Supplier payment')),
        occurredAt: this.rowString(payment.paid_at),
        balance: '',
      })
    }
    entries.sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.id.localeCompare(right.id),
    )
    let balance = 0n
    let totalPurchases = 0n
    let totalPayments = 0n
    let totalReturns = 0n
    for (const entry of entries) {
      const amount = parseSignedDecimal(entry.amount, 'Statement amount')
      balance += amount
      if (entry.type === 'purchase') totalPurchases += amount
      if (entry.type === 'payment') totalPayments -= amount
      if (entry.type === 'return') totalReturns -= amount
      entry.balance = formatDecimal(balance)
    }
    return {
      supplier,
      branchId,
      totalPurchases: formatDecimal(totalPurchases),
      totalPayments: formatDecimal(totalPayments),
      totalReturns: formatDecimal(totalReturns),
      balanceDue: formatDecimal(balance > 0n ? balance : 0n),
      supplierCredit: formatDecimal(balance < 0n ? -balance : 0n),
      entries,
    }
  }

  private async mapPurchase(
    row: SqlRow,
    executor: SqlExecutor,
  ): Promise<Purchase> {
    const purchaseId = this.rowString(row.id)
    const [items, payments, returns] = await Promise.all([
      this.repository.getPurchaseItems(purchaseId, executor),
      this.repository.getPayments(purchaseId, executor),
      this.repository.getReturns(purchaseId, executor),
    ])
    let paidTotal = 0n
    for (const payment of payments) {
      paidTotal += parseSignedDecimal(this.rowString(payment.amount), 'Supplier payment')
    }
    let returnedTotal = 0n
    for (const item of returns) {
      returnedTotal += parseDecimal(this.rowString(item.refund_total), 'Purchase return')
    }
    const received = ['received', 'partially_returned', 'returned'].includes(
      this.rowString(row.status),
    )
    const liability = received
      ? parseDecimal(this.rowString(row.total), 'Purchase total') -
        returnedTotal -
        paidTotal
      : 0n
    const mappedItems = await Promise.all(items.map(async (item) => {
      const lineReturns = await this.repository.listReturnsForPurchaseItem(
        this.rowString(item.id),
        executor,
      )
      const returnedQuantity = lineReturns.reduce(
        (sum, returned) =>
          sum + parseDecimal(this.rowString(returned.quantity), 'Returned quantity'),
        0n,
      )
      return {
        id: this.rowString(item.id),
        productId: this.rowString(item.product_id),
        sku: this.rowString(item.sku),
        productName: this.rowString(item.product_name),
        unitId: this.rowString(item.unit_id),
        unitName: this.rowString(item.unit_name),
        quantity: this.rowString(item.quantity),
        unitCost: this.rowString(item.unit_cost),
        discountTotal: this.rowString(item.discount_total),
        lineTotal: this.rowString(item.line_total),
        returnedQuantity: formatDecimal(returnedQuantity),
      }
    }))
    const mappedReturns = await Promise.all(returns.map(async (returned) => {
      const returnId = this.rowString(returned.id)
      const rows = await executor.query(
        `SELECT pri.quantity, pri.refund_amount, pi.product_id,
                p.sku, p.name AS product_name
         FROM purchase_return_items pri
         JOIN purchase_items pi ON pi.id = pri.purchase_item_id
         JOIN products p ON p.id = pi.product_id
         WHERE pri.return_id = ? ORDER BY pri.created_at, pri.id`,
        [returnId],
      )
      return {
        id: returnId,
        returnNumber: this.rowString(returned.return_number),
        reason: this.rowString(returned.reason),
        refundTotal: this.rowString(returned.refund_total),
        createdAt: this.rowString(returned.created_at),
        items: rows.map((item) => ({
          productId: this.rowString(item.product_id),
          sku: this.rowString(item.sku),
          productName: this.rowString(item.product_name),
          quantity: this.rowString(item.quantity),
          refundAmount: this.rowString(item.refund_amount),
        })),
      }
    }))
    return {
      id: purchaseId,
      branchId: this.rowString(row.branch_id),
      warehouseId: this.rowString(row.warehouse_id),
      supplierId: this.rowString(row.supplier_id),
      supplierCode: this.rowString(row.supplier_code),
      supplierName: this.rowString(row.supplier_name),
      invoiceNumber: this.rowString(row.invoice_number),
      supplierInvoiceNumber:
        typeof row.supplier_invoice_number === 'string'
          ? row.supplier_invoice_number
          : null,
      status: this.rowString(row.status),
      subtotal: this.rowString(row.subtotal),
      discountTotal: this.rowString(row.discount_total),
      total: this.rowString(row.total),
      paidTotal: formatDecimal(paidTotal),
      returnedTotal: formatDecimal(returnedTotal),
      outstandingBalance: formatDecimal(liability > 0n ? liability : 0n),
      supplierCredit: formatDecimal(liability < 0n ? -liability : 0n),
      notes: typeof row.notes === 'string' ? row.notes : null,
      createdAt: this.rowString(row.created_at),
      receivedAt: typeof row.received_at === 'string' ? row.received_at : null,
      items: mappedItems,
      payments: payments.map((payment) => ({
        id: this.rowString(payment.id),
        amount: this.rowString(payment.amount),
        method: this.rowString(payment.payment_method),
        reference: typeof payment.reference === 'string' ? payment.reference : null,
        paidAt: this.rowString(payment.paid_at),
      })),
      returns: mappedReturns,
    }
  }

  private mapSupplier(row: SqlRow): Supplier {
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

  private async requirePurchase(
    purchaseId: string,
    executor: SqlExecutor,
  ): Promise<SqlRow> {
    if (!uuidSchema.safeParse(purchaseId).success) {
      throw new PurchasesError('The purchase identifier is invalid')
    }
    const purchase = await this.repository.getPurchase(purchaseId, executor)
    if (!purchase) {
      throw new PurchasesError('The purchase does not exist')
    }
    return purchase
  }

  private async assertWarehousePermission(
    actorId: string,
    permission: 'purchases.create' | 'purchases.read' | 'purchases.returns',
    warehouseId: string,
    executor: SqlExecutor,
  ): Promise<{ branchId: string }> {
    const warehouse = await this.repository.getWarehouse(warehouseId, executor)
    if (
      !warehouse ||
      warehouse.warehouse_status !== 'active' ||
      warehouse.branch_status !== 'active'
    ) {
      throw new PurchasesError('The warehouse or its branch is inactive')
    }
    const branchId = this.rowString(warehouse.branch_id)
    await this.access.assertWarehousePermission(
      actorId,
      permission,
      warehouseId,
      branchId,
      executor,
    )
    await this.access.assertBranchAccess(actorId, branchId, executor)
    return { branchId }
  }

  private async assertWarehouseScope(
    actorId: string,
    warehouseId: string,
    executor: SqlExecutor,
  ): Promise<void> {
    const warehouse = await this.repository.getWarehouse(warehouseId, executor)
    if (!warehouse) {
      throw new PurchasesError('The purchase warehouse does not exist')
    }
    const branchId = this.rowString(warehouse.branch_id)
    await this.access.assertWarehouseAccess(
      actorId,
      warehouseId,
      branchId,
      executor,
    )
    await this.access.assertBranchAccess(actorId, branchId, executor)
  }

  private async canReadPurchase(
    actorId: string,
    purchase: SqlRow,
    executor: SqlExecutor,
  ): Promise<boolean> {
    try {
      await this.assertWarehousePermission(
        actorId,
        'purchases.read',
        this.rowString(purchase.warehouse_id),
        executor,
      )
      return true
    } catch (error) {
      if (error instanceof PurchasesError || error instanceof AuthorizationError) {
        return false
      }
      throw error
    }
  }

  private async getPurchaseBalance(
    purchase: SqlRow,
    executor: SqlExecutor,
  ): Promise<bigint> {
    const purchaseId = this.rowString(purchase.id)
    const total = parseDecimal(this.rowString(purchase.total), 'Purchase total')
    const returns = await this.repository.getReturns(purchaseId, executor)
    const returnTotal = returns.reduce(
      (sum, item) => sum + parseDecimal(this.rowString(item.refund_total), 'Purchase return'),
      0n,
    )
    const payments = await this.repository.getPayments(purchaseId, executor)
    const paidTotal = payments.reduce(
      (sum, item) => sum + parseSignedDecimal(this.rowString(item.amount), 'Supplier payment'),
      0n,
    )
    const due = total - returnTotal - paidTotal
    return due > 0n ? due : 0n
  }

  private async purchaseReturnTotalForPurchase(
    purchase: SqlRow,
    executor: SqlExecutor,
  ): Promise<bigint> {
    const returns = await this.repository.getReturns(this.rowString(purchase.id), executor)
    return returns.reduce(
      (sum, item) => sum + parseDecimal(this.rowString(item.refund_total), 'Purchase return'),
      0n,
    )
  }

  private async purchasePaymentTotalForPurchase(
    purchase: SqlRow,
    executor: SqlExecutor,
  ): Promise<bigint> {
    const payments = await this.repository.getPayments(this.rowString(purchase.id), executor)
    return payments.reduce(
      (sum, item) => sum + parseSignedDecimal(this.rowString(item.amount), 'Supplier payment'),
      0n,
    )
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
    const values: Record<string, string | number | null> = {}
    for (const [key, value] of Object.entries(row)) {
      if (value === undefined || value instanceof Uint8Array) {
        continue
      }
      values[key] = value
    }
    return values
  }

  private rowString(value: unknown): string {
    if (typeof value !== 'string') {
      throw new PurchasesError('A purchase record contains invalid data')
    }
    return value
  }

  private rowInteger(value: unknown): number {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 9) {
      throw new PurchasesError('A purchase unit precision is invalid')
    }
    return parsed
  }
}

function parseSignedDecimal(value: string, field: string): bigint {
  return value.startsWith('-')
    ? -parseDecimal(value.slice(1), field)
    : parseDecimal(value, field)
}
