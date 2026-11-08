import { z } from 'zod'
import { createUuid } from '../../infrastructure/database/uuid'
import type { SqlDatabase } from '../../infrastructure/database/types'
import type { SqlExecutor, SqlRow } from '../../infrastructure/database/types'
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
import { SalesError } from './sales.errors'
import { SalesRepository } from './SalesRepository'

const uuidSchema = z.string().uuid()
const decimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/)
const saleInputSchema = z.object({
  warehouseId: uuidSchema,
  customerId: uuidSchema.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  items: z.array(z.object({
    productId: uuidSchema,
    unitId: uuidSchema,
    quantity: decimalSchema,
    unitPrice: decimalSchema.optional(),
    discount: decimalSchema.default('0'),
  })).min(1).max(500),
  payments: z.array(z.object({
    amount: decimalSchema,
    method: z.enum(['cash', 'card', 'bank_transfer', 'mobile', 'other']),
    reference: z.string().trim().max(200).nullable().optional(),
  })).max(50).default([]),
})
const taxInputSchema = z.object({
  branchId: uuidSchema,
  taxRate: decimalSchema,
  taxMode: z.enum(['exclusive', 'inclusive']),
})
const searchSchema = z.object({
  warehouseId: uuidSchema,
  query: z.string().trim().max(128).default(''),
  limit: z.number().int().min(1).max(100).default(30),
})
const historySchema = z.object({
  branchId: uuidSchema,
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).max(1_000_000).default(0),
})
const customerSearchSchema = z.object({
  query: z.string().trim().max(128).default(''),
  limit: z.number().int().min(1).max(100).default(50),
})
const returnInputSchema = z.object({
  reason: z.string().trim().min(2).max(500),
  items: z.array(z.object({
    saleItemId: uuidSchema,
    quantity: decimalSchema,
  })).min(1).max(500),
  refundAmount: decimalSchema.default('0'),
  refundMethod: z.enum(['cash', 'card', 'bank_transfer', 'mobile']).optional(),
  refundReference: z.string().trim().max(200).nullable().optional(),
})

export type SalesTaxConfiguration = {
  branchId: string
  taxRate: string
  taxMode: 'exclusive' | 'inclusive'
}

export type SalesProduct = {
  id: string
  sku: string
  name: string
  baseUnitId: string
  baseUnitName: string
  sellingPrice: string
  stock: string
  barcode: string | null
  barcodeUnitId: string | null
  units: Array<{
    id: string
    code: string
    name: string
    decimalPlaces: number
    factorToBase: string
  }>
}

export type Sale = {
  id: string
  branchId: string
  warehouseId: string
  customerId: string | null
  customerName: string | null
  invoiceNumber: string
  status: string
  subtotal: string
  discountTotal: string
  taxTotal: string
  taxRate: string
  taxMode: 'exclusive' | 'inclusive'
  total: string
  amountPaid: string
  amountRefunded: string
  returnedTotal: string
  outstandingBalance: string
  customerCredit: string
  notes: string | null
  createdAt: string
  items: Array<{
    id: string
    productId: string
    sku: string
    productName: string
    unitId: string
    unitName: string
    quantity: string
    unitPrice: string
    discountTotal: string
    taxTotal: string
    lineTotal: string
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
    status: string
    reason: string
    refundTotal: string
    createdAt: string
    items: Array<{
      saleItemId: string
      productId: string
      sku: string
      productName: string
      quantity: string
      refundAmount: string
    }>
  }>
}

type CalculatedSaleItem = {
  id: string
  productId: string
  unitId: string
  quantity: string
  unitPrice: string
  discount: bigint
  tax: bigint
  lineTotal: bigint
}

export class SalesService {
  private readonly database: SqlDatabase
  private readonly access: AccessControlService
  private readonly authRepository: AuthRepository
  private readonly inventory: InventoryService
  private readonly repository: SalesRepository

  constructor(database: SqlDatabase) {
    this.database = database
    this.access = new AccessControlService(database)
    this.authRepository = new AuthRepository(database)
    this.inventory = new InventoryService(database)
    this.repository = new SalesRepository(database)
  }

  async searchProducts(actorId: string, input: unknown): Promise<SalesProduct[]> {
    const parsed = searchSchema.safeParse(input)
    if (!parsed.success) {
      throw new SalesError('The product search details are invalid')
    }
    await this.assertWarehousePermission(
      actorId,
      'sales.create',
      parsed.data.warehouseId,
      this.database,
    )
    const rows = await this.repository.searchProducts(
      parsed.data.query,
      parsed.data.warehouseId,
      parsed.data.limit,
    )
    const products: SalesProduct[] = []
    for (const row of rows) {
      const id = this.rowString(row.id)
      const barcodeUnitId =
        typeof row.barcode_unit_id === 'string' ? row.barcode_unit_id : null
      products.push({
        id,
        sku: this.rowString(row.sku),
        name: this.rowString(row.name),
        baseUnitId: this.rowString(row.base_unit_id),
        baseUnitName: this.rowString(row.base_unit_name),
        sellingPrice: this.rowString(row.selling_price),
        stock: this.rowString(row.stock),
        barcode: typeof row.barcode === 'string' ? row.barcode : null,
        barcodeUnitId,
        units: (await this.repository.listUnits(id)).map((unit) => ({
          id: this.rowString(unit.id),
          code: this.rowString(unit.code),
          name: this.rowString(unit.name),
          decimalPlaces: this.rowInteger(unit.decimal_places),
          factorToBase: this.rowString(unit.factor_to_base),
        })),
      })
    }
    return products
  }

  async listCustomers(actorId: string, input: unknown = {}): Promise<Array<{
    id: string
    code: string
    name: string
    phone: string | null
    email: string | null
  }>> {
    const parsed = customerSearchSchema.safeParse(input)
    if (!parsed.success) {
      throw new SalesError('The customer search details are invalid')
    }
    await this.access.assertPermission(actorId, 'sales.create')
    return (await this.repository.listCustomers(
      parsed.data.query,
      parsed.data.limit,
    )).map((row) => ({
      id: this.rowString(row.id),
      code: this.rowString(row.code),
      name: this.rowString(row.name),
      phone: typeof row.phone === 'string' ? row.phone : null,
      email: typeof row.email === 'string' ? row.email : null,
    }))
  }

  async getTaxConfiguration(
    actorId: string,
    branchId: string,
  ): Promise<SalesTaxConfiguration> {
    await this.assertBranchPermission(actorId, 'sales.create', branchId)
    const tax = await this.repository.getTaxSetting(branchId)
    return { branchId, ...tax }
  }

  async setTaxConfiguration(
    actorId: string,
    input: unknown,
  ): Promise<void> {
    const parsed = taxInputSchema.safeParse(input)
    if (!parsed.success || parseDecimal(parsed.data.taxRate, 'Tax rate') > parseDecimal('100', 'Maximum tax rate')) {
      throw new SalesError('The tax configuration is invalid')
    }
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'settings.manage', transaction)
      await this.access.assertBranchAccess(
        actorId,
        parsed.data.branchId,
        transaction,
      )
      const branchRow = await this.repository.getBranch(parsed.data.branchId, transaction)
      if (!branchRow || branchRow.status !== 'active') {
        throw new SalesError('The active tax configuration branch does not exist')
      }
      const before = await this.repository.getTaxSetting(
        parsed.data.branchId,
        transaction,
      )
      await this.repository.setTaxSetting({
        branchId: parsed.data.branchId,
        taxRate: parsed.data.taxRate,
        taxMode: parsed.data.taxMode,
        actorId,
        updatedAt: new Date().toISOString(),
      }, transaction)
      await this.writeAudit(
        transaction,
        actorId,
        'sales.tax_configuration_updated',
        'sales_tax_setting',
        parsed.data.branchId,
        before,
        { taxRate: parsed.data.taxRate, taxMode: parsed.data.taxMode },
        new Date().toISOString(),
      )
    })
  }

  async createSale(actorId: string, input: unknown): Promise<string> {
    const parsed = saleInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new SalesError('The sale details are invalid')
    }
    if (
      new Set(parsed.data.items.map((item) => item.productId)).size !==
      parsed.data.items.length
    ) {
      throw new SalesError('A product may appear only once in a sale')
    }

    const saleId = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const location = await this.assertWarehousePermission(
        actorId,
        'sales.create',
        parsed.data.warehouseId,
        transaction,
      )
      const customerId = parsed.data.customerId ?? null
      if (customerId && !(await this.repository.getCustomer(customerId, transaction))) {
        throw new SalesError('The selected customer does not exist or is inactive')
      }
      const taxSetting = await this.repository.getTaxSetting(
        location.branchId,
        transaction,
      )
      const calculated: CalculatedSaleItem[] = []
      let subtotal = 0n
      let discountTotal = 0n
      let taxTotal = 0n
      let total = 0n
      for (const item of parsed.data.items) {
        const product = await this.repository.getProduct(item.productId, transaction)
        if (!product || product.status !== 'active') {
          throw new SalesError('A selected product does not exist or is inactive')
        }
        const unit = await this.repository.getUnit(
          item.productId,
          item.unitId,
          transaction,
        )
        if (!unit) {
          throw new SalesError('A selected unit is inactive or not configured for the product')
        }
        const quantity = parseDecimal(item.quantity, 'Quantity')
        if (quantity <= 0n) {
          throw new SalesError('Sale quantity must be greater than zero')
        }
        const factor = parseDecimal(
          this.rowString(unit.factor_to_base),
          'Unit conversion factor',
        )
        const baseUnit = await this.repository.getUnit(
          item.productId,
          this.rowString(product.base_unit_id),
          transaction,
        )
        if (
          !quantityWithinPrecision(quantity, this.rowInteger(unit.decimal_places)) ||
          !baseUnit ||
          !quantityWithinPrecision(
            multiplyDecimal(quantity, factor),
            this.rowInteger(baseUnit.decimal_places),
          )
        ) {
          throw new SalesError('Sale quantity exceeds the selected unit precision')
        }
        const baseListedPrice = parseDecimal(
          this.rowString(product.selling_price),
          'Product selling price',
        )
        const listedPrice = multiplyDecimal(baseListedPrice, factor)
        const unitPriceText =
          item.unitPrice ?? formatDecimal(listedPrice)
        const unitPrice = parseDecimal(unitPriceText, 'Unit price')
        if (unitPrice !== listedPrice || parseDecimal(item.discount, 'Discount') > 0n) {
          await this.access.assertPermission(actorId, 'sales.discount', transaction)
        }
        const gross = multiplyDecimal(quantity, unitPrice)
        const discount = parseDecimal(item.discount, 'Discount')
        if (discount > gross) {
          throw new SalesError('A line discount cannot exceed its gross amount')
        }
        const afterDiscount = gross - discount
        let lineTax: bigint
        let lineTotal: bigint
        if (taxSetting.taxMode === 'inclusive') {
          lineTax = divideDecimal(
            multiplyDecimal(afterDiscount, parseDecimal(taxSetting.taxRate, 'Tax rate')),
            parseDecimal('100', 'Percentage base') +
              parseDecimal(taxSetting.taxRate, 'Tax rate'),
          )
          lineTotal = afterDiscount
        } else {
          lineTax = divideDecimal(
            multiplyDecimal(afterDiscount, parseDecimal(taxSetting.taxRate, 'Tax rate')),
            parseDecimal('100', 'Percentage base'),
          )
          lineTotal = afterDiscount + lineTax
        }
        calculated.push({
          id: createUuid(),
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: unitPriceText,
          discount,
          tax: lineTax,
          lineTotal,
        })
        subtotal += gross
        discountTotal += discount
        taxTotal += lineTax
        total += lineTotal
      }
      const paymentTotal = parsed.data.payments.reduce(
        (sum, payment) => sum + parseDecimal(payment.amount, 'Payment amount'),
        0n,
      )
      if (paymentTotal > total) {
        throw new SalesError('Payment total cannot exceed the invoice total')
      }
      if (paymentTotal < total && !customerId) {
        throw new SalesError('A customer is required for a credit or partially paid sale')
      }
      const count = await this.repository.getSaleCount(location.branchId, transaction)
      const invoiceNumber = `INV-${String(count + 1).padStart(6, '0')}`
      await this.repository.createSale({
        id: saleId,
        branchId: location.branchId,
        warehouseId: parsed.data.warehouseId,
        customerId,
        invoiceNumber,
        subtotal: formatDecimal(subtotal),
        discountTotal: formatDecimal(discountTotal),
        taxTotal: formatDecimal(taxTotal),
        taxRate: taxSetting.taxRate,
        taxMode: taxSetting.taxMode,
        total: formatDecimal(total),
        notes: parsed.data.notes ?? null,
        actorId,
        createdAt: now,
      }, transaction)
      for (const item of calculated) {
        await this.repository.addSaleItem({
          id: item.id,
          saleId,
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountTotal: formatDecimal(item.discount),
          taxTotal: formatDecimal(item.tax),
          lineTotal: formatDecimal(item.lineTotal),
          createdAt: now,
        }, transaction)
      }
      for (const payment of parsed.data.payments) {
        const amount = parseDecimal(payment.amount, 'Payment amount')
        if (amount === 0n) {
          continue
        }
        await this.repository.addSalePayment({
          id: createUuid(),
          saleId,
          amount: formatDecimal(amount),
          paymentMethod: payment.method,
          reference: payment.reference ?? null,
          actorId,
          paidAt: now,
        }, transaction)
      }
      await this.inventory.postSaleOutbound(
        actorId,
        parsed.data.warehouseId,
        saleId,
        calculated.map((item) => ({
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
        })),
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'sale.posted',
        'sale',
        saleId,
        null,
        {
          invoiceNumber,
          customerId,
          warehouseId: parsed.data.warehouseId,
          subtotal: formatDecimal(subtotal),
          discountTotal: formatDecimal(discountTotal),
          taxTotal: formatDecimal(taxTotal),
          taxRate: taxSetting.taxRate,
          taxMode: taxSetting.taxMode,
          total: formatDecimal(total),
          paymentTotal: formatDecimal(paymentTotal),
          itemCount: calculated.length,
        },
        now,
      )
    })
    return saleId
  }

  async getSale(actorId: string, saleId: string): Promise<Sale> {
    const sale = await this.requireSale(saleId, this.database)
    const principal = await this.authRepository.getPrincipal(actorId)
    const canReadAll = principal?.permissions.includes('sales.read') ?? false
    const isCreatorWithCreate =
      principal?.permissions.includes('sales.create') === true &&
      sale.created_by === actorId
    if (!canReadAll && !isCreatorWithCreate) {
      throw new AuthorizationError('Permission required: sales.read')
    }
    await this.assertWarehouseScope(
      actorId,
      this.rowString(sale.warehouse_id),
      this.database,
    )
    return this.mapSale(sale, this.database)
  }

  async listSales(actorId: string, input: unknown): Promise<Sale[]> {
    const parsed = historySchema.safeParse(input)
    if (!parsed.success) {
      throw new SalesError('The sales history filter is invalid')
    }
    await this.assertBranchPermission(actorId, 'sales.read', parsed.data.branchId)
    const rows = await this.repository.listSales(
      parsed.data.branchId,
      parsed.data.limit,
      parsed.data.offset,
    )
    const sales: Sale[] = []
    for (const row of rows) {
      if (await this.canReadSale(actorId, row, this.database)) {
        sales.push(await this.mapSale(row, this.database))
      }
    }
    return sales
  }

  async cancelSale(actorId: string, saleId: string): Promise<void> {
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const sale = await this.requireSale(saleId, transaction)
      await this.assertWarehousePermission(
        actorId,
        'sales.cancel',
        this.rowString(sale.warehouse_id),
        transaction,
      )
      if (sale.status !== 'posted') {
        throw new SalesError('Only posted, not-yet-returned sales can be cancelled')
      }
      const returns = await this.repository.listReturns(saleId, transaction)
      if (returns.length > 0) {
        throw new SalesError('A sale with returns cannot be cancelled')
      }
      const items = await this.repository.getSaleItems(saleId, transaction)
      await this.inventory.postSaleCancellationInbound(
        actorId,
        this.rowString(sale.warehouse_id),
        saleId,
        saleId,
        items.map((item) => ({
          productId: this.rowString(item.product_id),
          unitId: this.rowString(item.unit_id),
          quantity: this.rowString(item.quantity),
        })),
        transaction,
      )
      const payments = await this.repository.getSalePayments(saleId, transaction)
      for (const payment of payments) {
        const amount = parseSignedDecimal(this.rowString(payment.amount), 'Payment amount')
        if (amount <= 0n) {
          continue
        }
        await this.repository.addSalePayment({
          id: createUuid(),
          saleId,
          amount: formatDecimal(-amount),
          paymentMethod: `refund_${this.rowString(payment.payment_method)}`,
          reference: `Cancellation of ${this.rowString(sale.invoice_number)}`,
          actorId,
          paidAt: now,
        }, transaction)
      }
      await this.repository.updateSaleStatus(saleId, 'cancelled', now, transaction)
      await this.writeAudit(
        transaction,
        actorId,
        'sale.cancelled',
        'sale',
        saleId,
        { status: sale.status },
        { status: 'cancelled' },
        now,
      )
    })
  }

  async returnSale(
    actorId: string,
    saleId: string,
    input: unknown,
  ): Promise<string> {
    const parsed = returnInputSchema.safeParse(input)
    if (
      !parsed.success ||
      !uuidSchema.safeParse(saleId).success ||
      new Set(parsed.data.items.map((item) => item.saleItemId)).size !==
        parsed.data.items.length
    ) {
      throw new SalesError('The sales return details are invalid')
    }
    const returnId = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const sale = await this.requireSale(saleId, transaction)
      await this.assertWarehousePermission(
        actorId,
        'sales.returns',
        this.rowString(sale.warehouse_id),
        transaction,
      )
      if (!['posted', 'partially_returned'].includes(this.rowString(sale.status))) {
        throw new SalesError('Only active posted sales can be returned')
      }
      const lines: Array<{
        saleItemId: string
        productId: string
        unitId: string
        quantity: string
        refundAmount: bigint
      }> = []
      let returnTotal = 0n
      for (const inputItem of parsed.data.items) {
        const saleItem = await this.repository.getSaleItem(inputItem.saleItemId, transaction)
        if (!saleItem || saleItem.sale_id !== saleId) {
          throw new SalesError('A selected item does not belong to this sale')
        }
        const originalQuantity = parseDecimal(this.rowString(saleItem.quantity), 'Sold quantity')
        const returnQuantity = parseDecimal(inputItem.quantity, 'Return quantity')
        if (returnQuantity <= 0n) {
          throw new SalesError('Return quantity must be greater than zero')
        }
        const priorReturns = await this.repository.listReturnsForSaleItem(
          inputItem.saleItemId,
          transaction,
        )
        const previouslyReturned = priorReturns.reduce(
          (sum, row) => sum + parseDecimal(this.rowString(row.quantity), 'Previously returned quantity'),
          0n,
        )
        if (previouslyReturned + returnQuantity > originalQuantity) {
          throw new SalesError('Return quantity exceeds the unreturned quantity')
        }
        const alreadyRefunded = priorReturns.reduce(
          (sum, row) => sum + parseDecimal(this.rowString(row.refund_amount), 'Previously refunded value'),
          0n,
        )
        const itemTotal = parseDecimal(this.rowString(saleItem.line_total), 'Sale line total')
        const refundAmount =
          previouslyReturned + returnQuantity === originalQuantity
            ? itemTotal - alreadyRefunded
            : divideDecimal(
                multiplyDecimal(itemTotal, returnQuantity),
                originalQuantity,
              )
        lines.push({
          saleItemId: inputItem.saleItemId,
          productId: this.rowString(saleItem.product_id),
          unitId: this.rowString(saleItem.unit_id),
          quantity: inputItem.quantity,
          refundAmount,
        })
        returnTotal += refundAmount
      }

      const refundAmount = parseDecimal(parsed.data.refundAmount, 'Refund amount')
      if (refundAmount > returnTotal) {
        throw new SalesError('Refund cannot exceed the value of returned items')
      }
      if (refundAmount > 0n && !parsed.data.refundMethod) {
        throw new SalesError('A refund method is required for a cash refund')
      }
      const payments = await this.repository.getSalePayments(saleId, transaction)
      const collected = payments.reduce(
        (sum, row) => sum + parseSignedDecimal(this.rowString(row.amount), 'Payment amount'),
        0n,
      )
      if (refundAmount > collected) {
        throw new SalesError('Refund cannot exceed the net amount collected')
      }
      const count = await transaction.query<{ return_count: number }>(
        'SELECT COUNT(*) AS return_count FROM sales_returns WHERE sale_id = ?',
        [saleId],
      )
      const returnNumber = `RET-${String(Number(count[0]?.return_count ?? 0) + 1).padStart(4, '0')}`
      await this.repository.createReturn({
        id: returnId,
        saleId,
        returnNumber,
        reason: parsed.data.reason,
        refundTotal: formatDecimal(returnTotal),
        actorId,
        createdAt: now,
      }, transaction)
      for (const line of lines) {
        await this.repository.addReturnItem({
          id: createUuid(),
          returnId,
          saleItemId: line.saleItemId,
          quantity: line.quantity,
          refundAmount: formatDecimal(line.refundAmount),
          createdAt: now,
        }, transaction)
      }
      await this.inventory.postSaleReturnInbound(
        actorId,
        this.rowString(sale.warehouse_id),
        saleId,
        returnId,
        lines.map((line) => ({
          productId: line.productId,
          unitId: line.unitId,
          quantity: line.quantity,
        })),
        transaction,
      )
      if (refundAmount > 0n) {
        await this.repository.addSalePayment({
          id: createUuid(),
          saleId,
          amount: formatDecimal(-refundAmount),
          paymentMethod: `refund_${parsed.data.refundMethod!}`,
          reference: parsed.data.refundReference ?? `Refund for ${returnNumber}`,
          actorId,
          paidAt: now,
        }, transaction)
      }
      const allItems = await this.repository.getSaleItems(saleId, transaction)
      const allReturnedItems = await this.repository.listReturnItemsForSale(
        saleId,
        transaction,
      )
      const returnedQuantities = new Map<string, bigint>()
      for (const row of allReturnedItems) {
        const itemId = this.rowString(row.sale_item_id)
        returnedQuantities.set(
          itemId,
          (returnedQuantities.get(itemId) ?? 0n) +
            parseDecimal(this.rowString(row.quantity), 'Returned quantity'),
        )
      }
      const fullyReturned = allItems.every(
        (item) =>
          (returnedQuantities.get(this.rowString(item.id)) ?? 0n) >=
          parseDecimal(this.rowString(item.quantity), 'Sold quantity'),
      )
      await this.repository.updateSaleStatus(
        saleId,
        fullyReturned ? 'returned' : 'partially_returned',
        now,
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'sale.returned',
        'sales_return',
        returnId,
        null,
        {
          saleId,
          returnNumber,
          reason: parsed.data.reason,
          refundTotal: formatDecimal(returnTotal),
          cashRefund: formatDecimal(refundAmount),
        },
        now,
      )
    })
    return returnId
  }

  private async mapSale(row: SqlRow, executor: SqlExecutor): Promise<Sale> {
    const saleId = this.rowString(row.id)
    const [itemRows, paymentRows, returnRows] = await Promise.all([
      this.repository.getSaleItems(saleId, executor),
      this.repository.getSalePayments(saleId, executor),
      this.repository.listReturns(saleId, executor),
    ])
    const amountPaid = paymentRows.reduce(
      (sum, payment) =>
        sum + parseSignedDecimal(this.rowString(payment.amount), 'Payment amount'),
      0n,
    )
    const amountRefunded = paymentRows.reduce((sum, payment) => {
      const amount = parseSignedDecimal(this.rowString(payment.amount), 'Payment amount')
      return amount < 0n ? sum - amount : sum
    }, 0n)
    const returnedTotal = returnRows.reduce(
      (sum, item) => sum + parseDecimal(this.rowString(item.refund_total), 'Returned value'),
      0n,
    )
    const remaining =
      this.rowString(row.status) === 'cancelled'
        ? 0n
        : parseDecimal(this.rowString(row.total), 'Sale total') -
          returnedTotal -
          amountPaid
    const returns = await Promise.all(
      returnRows.map(async (item) => ({
        id: this.rowString(item.id),
        returnNumber: this.rowString(item.return_number),
        status: this.rowString(item.status),
        reason: this.rowString(item.reason),
        refundTotal: this.rowString(item.refund_total),
        createdAt: this.rowString(item.created_at),
        items: (await this.repository.listReturnItems(
          this.rowString(item.id),
          executor,
        )).map((returnItem) => ({
          saleItemId: this.rowString(returnItem.sale_item_id),
          productId: this.rowString(returnItem.product_id),
          sku: this.rowString(returnItem.sku),
          productName: this.rowString(returnItem.product_name),
          quantity: this.rowString(returnItem.quantity),
          refundAmount: this.rowString(returnItem.refund_amount),
        })),
      })),
    )
    return {
      id: saleId,
      branchId: this.rowString(row.branch_id),
      warehouseId: this.rowString(row.warehouse_id),
      customerId: typeof row.customer_id === 'string' ? row.customer_id : null,
      customerName: typeof row.customer_name === 'string' ? row.customer_name : null,
      invoiceNumber: this.rowString(row.invoice_number),
      status: this.rowString(row.status),
      subtotal: this.rowString(row.subtotal),
      discountTotal: this.rowString(row.discount_total),
      taxTotal: this.rowString(row.tax_total),
      taxRate: this.rowString(row.tax_rate),
      taxMode: this.rowTaxMode(row.tax_mode),
      total: this.rowString(row.total),
      amountPaid: formatDecimal(amountPaid),
      amountRefunded: formatDecimal(amountRefunded),
      returnedTotal: formatDecimal(returnedTotal),
      outstandingBalance: formatDecimal(remaining > 0n ? remaining : 0n),
      customerCredit: formatDecimal(remaining < 0n ? -remaining : 0n),
      notes: typeof row.notes === 'string' ? row.notes : null,
      createdAt: this.rowString(row.created_at),
      items: itemRows.map((item) => ({
        id: this.rowString(item.id),
        productId: this.rowString(item.product_id),
        sku: this.rowString(item.sku),
        productName: this.rowString(item.product_name),
        unitId: this.rowString(item.unit_id),
        unitName: this.rowString(item.unit_name),
        quantity: this.rowString(item.quantity),
        unitPrice: this.rowString(item.unit_price),
        discountTotal: this.rowString(item.discount_total),
        taxTotal: this.rowString(item.tax_total),
        lineTotal: this.rowString(item.line_total),
      })),
      payments: paymentRows.map((payment) => ({
        id: this.rowString(payment.id),
        amount: this.rowString(payment.amount),
        method: this.rowString(payment.payment_method),
        reference: typeof payment.reference === 'string' ? payment.reference : null,
        paidAt: this.rowString(payment.paid_at),
      })),
      returns,
    }
  }

  private async requireSale(
    saleId: string,
    executor: SqlExecutor,
  ): Promise<SqlRow> {
    if (!uuidSchema.safeParse(saleId).success) {
      throw new SalesError('The sale identifier is invalid')
    }
    const sale = await this.repository.getSale(saleId, executor)
    if (!sale) {
      throw new SalesError('The sale does not exist')
    }
    return sale
  }

  private async assertWarehousePermission(
    actorId: string,
    permission: 'sales.create' | 'sales.read' | 'sales.cancel' | 'sales.returns',
    warehouseId: string,
    executor: SqlExecutor,
  ): Promise<{ branchId: string }> {
    const warehouse = await this.repository.getWarehouse(warehouseId, executor)
    if (
      !warehouse ||
      warehouse.warehouse_status !== 'active' ||
      warehouse.branch_status !== 'active'
    ) {
      throw new SalesError('The warehouse or its branch is inactive')
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

  private async assertBranchPermission(
    actorId: string,
    permission: 'sales.read' | 'sales.create',
    branchId: string,
  ): Promise<void> {
    await this.access.assertPermission(actorId, permission)
    await this.access.assertBranchAccess(actorId, branchId)
  }

  private async assertWarehouseScope(
    actorId: string,
    warehouseId: string,
    executor: SqlExecutor,
  ): Promise<void> {
    const warehouse = await this.repository.getWarehouse(warehouseId, executor)
    if (
      !warehouse ||
      warehouse.warehouse_status !== 'active' ||
      warehouse.branch_status !== 'active'
    ) {
      throw new SalesError('The warehouse or its branch is inactive')
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

  private async canReadSale(
    actorId: string,
    sale: SqlRow,
    executor: SqlExecutor,
  ): Promise<boolean> {
    try {
      await this.assertWarehousePermission(
        actorId,
        'sales.read',
        this.rowString(sale.warehouse_id),
        executor,
      )
      return true
    } catch (error) {
      if (error instanceof SalesError || error instanceof AuthorizationError) {
        return false
      }
      throw error
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

  private rowString(value: unknown): string {
    if (typeof value !== 'string') {
      throw new SalesError('A sales record contains invalid data')
    }
    return value
  }

  private rowInteger(value: unknown): number {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 9) {
      throw new SalesError('A sales unit precision is invalid')
    }
    return parsed
  }

  private rowTaxMode(value: unknown): 'exclusive' | 'inclusive' {
    if (value !== 'exclusive' && value !== 'inclusive') {
      throw new SalesError('A sales record contains an invalid tax mode')
    }
    return value
  }
}

function parseSignedDecimal(value: string, field: string): bigint {
  if (value.startsWith('-')) {
    return -parseDecimal(value.slice(1), field)
  }
  return parseDecimal(value, field)
}
