import { z } from 'zod'
import type { SqlDatabase } from '../../infrastructure/database/types'
import type { SqlExecutor, SqlRow } from '../../infrastructure/database/types'
import { AccessControlService } from '../auth/AccessControlService'
import { AuthRepository } from '../auth/AuthRepository'
import {
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
} from '../inventory/decimal'
import { ReportsError } from './reports.errors'
import { ReportsRepository } from './ReportsRepository'
import { generateExcel, generatePdf } from './reportExports'

const uuidSchema = z.string().uuid()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
})
const reportInputSchema = z.object({
  fromDate: dateSchema,
  toDate: dateSchema,
  branchId: uuidSchema.optional(),
}).refine((value) => value.fromDate <= value.toDate)

type ReportRow = Record<string, string | number | null>
type Branch = { id: string; code: string; name: string }

export type ReportBundle = {
  title: string
  period: { fromDate: string; toDate: string }
  branches: Branch[]
  accessibleBranches: Branch[]
  summary: Record<string, string>
  salesAnalytics: ReportRow[]
  purchaseAnalytics: ReportRow[]
  expenseReport: ReportRow[]
  profitAndLoss: ReportRow[]
  inventoryReport: ReportRow[]
  lowStockReport: ReportRow[]
  customerBalances: ReportRow[]
  supplierBalances: ReportRow[]
  branchPerformance: ReportRow[]
  manufacturingReport: ReportRow[]
}

type DailyMetrics = {
  invoiceCount: number
  grossSales: bigint
  salesTax: bigint
  returns: bigint
  returnedTax: bigint
  cancellations: bigint
  cancelledTax: bigint
  collections: bigint
  costOfGoodsSold: bigint
  purchaseCount: number
  grossPurchases: bigint
  purchaseReturns: bigint
}

type BranchMetrics = {
  sales: bigint
  salesReturns: bigint
  salesCancellations: bigint
  salesTax: bigint
  returnedTax: bigint
  cancelledTax: bigint
  expenses: bigint
  costOfGoodsSold: bigint
}

export class ReportsService {
  private readonly database: SqlDatabase
  private readonly access: AccessControlService
  private readonly authRepository: AuthRepository
  private readonly repository: ReportsRepository

  constructor(database: SqlDatabase) {
    this.database = database
    this.access = new AccessControlService(database)
    this.authRepository = new AuthRepository(database)
    this.repository = new ReportsRepository(database)
  }

  async getReports(actorId: string, input: unknown): Promise<ReportBundle> {
    const parsed = reportInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new ReportsError('The report date range or branch is invalid')
    }

    return this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'reports.read', transaction)
      const principal = await this.authRepository.getPrincipal(actorId, transaction)
      if (!principal) {
        throw new ReportsError('The report user is not active')
      }

      const isOwner = principal.roleCodes.some((role) =>
        ['system_owner', 'general_manager', 'admin'].includes(role),
      )
      const allowedBranches = await this.repository.listAccessibleBranches(
        isOwner ? null : principal.branchIds,
        transaction,
      )
      const accessibleBranches = allowedBranches.map((row) => ({
        id: this.rowString(row.id),
        code: this.rowString(row.code),
        name: this.rowString(row.name),
      }))
      const selectedBranches = parsed.data.branchId
        ? accessibleBranches.filter((branch) => branch.id === parsed.data.branchId)
        : accessibleBranches
      if (parsed.data.branchId && selectedBranches.length === 0) {
        await this.access.assertBranchAccess(
          actorId,
          parsed.data.branchId,
          transaction,
        )
        throw new ReportsError('The requested branch is not available for reports')
      }

      const from = `${parsed.data.fromDate}T00:00:00.000Z`
      const to = `${parsed.data.toDate}T23:59:59.999Z`
      const periodBranches: Array<{
        branch: Branch
        sales: SqlRow[]
        cancellations: SqlRow[]
        returns: SqlRow[]
        returnItems: SqlRow[]
        saleMovements: SqlRow[]
        payments: SqlRow[]
        purchases: SqlRow[]
        purchaseReturns: SqlRow[]
        expenses: SqlRow[]
        orders: SqlRow[]
      }> = []

      for (const branch of selectedBranches) {
        const [
          sales,
          cancellations,
          returns,
          returnItems,
          saleMovements,
          payments,
          purchases,
          purchaseReturns,
          expenses,
          orders,
        ] = await Promise.all([
          this.repository.listSales(branch.id, from, to, transaction),
          this.repository.listSalesCancellations(branch.id, from, to, transaction),
          this.repository.listSalesReturns(branch.id, from, to, transaction),
          this.repository.listSalesReturnItems(branch.id, from, to, transaction),
          this.repository.listSaleMovements(branch.id, from, to, transaction),
          this.repository.listSalePayments(branch.id, from, to, transaction),
          this.repository.listPurchases(branch.id, from, to, transaction),
          this.repository.listPurchaseReturns(branch.id, from, to, transaction),
          this.repository.listExpenses(branch.id, from, to, transaction),
          this.repository.listManufacturingOrders(branch.id, from, to, transaction),
        ])
        periodBranches.push({
          branch,
          sales,
          cancellations,
          returns,
          returnItems,
          saleMovements,
          payments,
          purchases,
          purchaseReturns,
          expenses,
          orders,
        })
      }

      const metricsByBranch = new Map<string, BranchMetrics>()
      const salesAnalytics: ReportRow[] = []
      const purchaseAnalytics: ReportRow[] = []
      const expenseReport: ReportRow[] = []
      const manufacturingReport: ReportRow[] = []
      let netPurchases = 0n
      let totalExpenses = 0n
      let totalCogs = 0n
      let totalProduction = 0n
      let totalWaste = 0n
      let totalProductionCost = 0n
      let totalCollections = 0n
      let salesInvoiceCount = 0
      let purchaseInvoiceCount = 0
      let completedOrders = 0

      for (const data of periodBranches) {
        const branchMetrics: BranchMetrics = {
          sales: 0n,
          salesReturns: 0n,
          salesCancellations: 0n,
          salesTax: 0n,
          returnedTax: 0n,
          cancelledTax: 0n,
          expenses: 0n,
          costOfGoodsSold: 0n,
        }
        const dailyForBranch = new Map<string, DailyMetrics>()
        const metricForDay = (date: string): DailyMetrics => {
          const day = date.slice(0, 10)
          let metrics = dailyForBranch.get(day)
          if (!metrics) {
            metrics = this.emptyDailyMetrics()
            dailyForBranch.set(day, metrics)
          }
          return metrics
        }

        for (const sale of data.sales) {
          const total = this.decimal(sale.total, 'Sale total')
          const tax = this.decimal(sale.tax_total, 'Sales tax')
          const dayMetrics = metricForDay(this.rowString(sale.created_at))
          dayMetrics.invoiceCount += 1
          salesInvoiceCount += 1
          dayMetrics.grossSales += total
          dayMetrics.salesTax += tax
          branchMetrics.sales += total
          branchMetrics.salesTax += tax
        }
        for (const cancellation of data.cancellations) {
          const amount = this.decimal(cancellation.total, 'Cancelled sale total')
          const tax = this.decimal(cancellation.tax_total, 'Cancelled sales tax')
          const dayMetrics = metricForDay(this.rowString(cancellation.updated_at))
          dayMetrics.cancellations += amount
          dayMetrics.cancelledTax += tax
          branchMetrics.salesCancellations += amount
          branchMetrics.cancelledTax += tax
        }
        let totalReturnTax = 0n
        for (const item of data.returnItems) {
          const refund = this.decimal(item.refund_amount, 'Sales refund')
          const lineTotal = this.decimal(item.line_total, 'Sale line total')
          const tax = this.decimal(item.tax_total, 'Sale line tax')
          if (lineTotal === 0n) continue
          totalReturnTax += divideDecimal(multiplyDecimal(refund, tax), lineTotal)
        }
        const returnTaxByDay = new Map<string, bigint>()
        for (const item of data.returnItems) {
          const refund = this.decimal(item.refund_amount, 'Sales refund')
          const lineTotal = this.decimal(item.line_total, 'Sale line total')
          const tax = this.decimal(item.tax_total, 'Sale line tax')
          const returnedTax = lineTotal === 0n
            ? 0n
            : divideDecimal(multiplyDecimal(refund, tax), lineTotal)
          const date = this.rowString(item.returned_at).slice(0, 10)
          returnTaxByDay.set(
            date,
            (returnTaxByDay.get(date) ?? 0n) + returnedTax,
          )
        }
        for (const row of data.returns) {
          const refund = this.decimal(row.refund_total, 'Sales refund')
          const dayMetrics = metricForDay(this.rowString(row.created_at))
          dayMetrics.returns += refund
          branchMetrics.salesReturns += refund
        }
        for (const [date, tax] of returnTaxByDay) {
          metricForDay(date).returnedTax += tax
        }
        branchMetrics.returnedTax += totalReturnTax

        for (const movement of data.saleMovements) {
          const value = multiplyDecimal(
            this.decimal(movement.quantity, 'Movement quantity'),
            this.decimal(movement.unit_cost, 'Movement unit cost'),
          )
          const type = this.rowString(movement.movement_type)
          const cost = type === 'sale_out' ? value : -value
          const dayMetrics = metricForDay(this.rowString(movement.occurred_at))
          dayMetrics.costOfGoodsSold += cost
          branchMetrics.costOfGoodsSold += cost
        }
        for (const payment of data.payments) {
          const collection = this.signedDecimal(payment.amount, 'Sale collection')
          metricForDay(this.rowString(payment.paid_at)).collections += collection
          totalCollections += collection
        }

        let grossPurchases = 0n
        let returnedPurchases = 0n
        for (const purchase of data.purchases) {
          grossPurchases += this.decimal(purchase.total, 'Purchase total')
          const dayMetrics = metricForDay(this.rowString(purchase.received_at))
          dayMetrics.purchaseCount += 1
          purchaseInvoiceCount += 1
          dayMetrics.grossPurchases += this.decimal(purchase.total, 'Purchase total')
        }
        for (const purchaseReturn of data.purchaseReturns) {
          const refund = this.decimal(
            purchaseReturn.refund_total,
            'Purchase refund',
          )
          returnedPurchases += refund
          metricForDay(this.rowString(purchaseReturn.created_at)).purchaseReturns +=
            refund
        }
        netPurchases += grossPurchases - returnedPurchases

        for (const expense of data.expenses) {
          const amount = this.decimal(expense.amount, 'Expense amount')
          totalExpenses += amount
          branchMetrics.expenses += amount
          expenseReport.push({
            branch: data.branch.name,
            date: this.rowString(expense.incurred_at).slice(0, 10),
            category: this.rowString(expense.category),
            description: this.rowString(expense.description),
            amount: formatDecimal(amount),
          })
        }

        for (const [date, metrics] of dailyForBranch) {
          const returnedTax = metrics.returnedTax
          salesAnalytics.push({
            branch: data.branch.name,
            date,
            invoiceCount: metrics.invoiceCount,
            grossSales: formatDecimal(metrics.grossSales),
            salesTax: formatDecimal(metrics.salesTax),
            returns: formatDecimal(metrics.returns),
            returnedTax: formatDecimal(returnedTax),
            cancellations: formatDecimal(metrics.cancellations),
            cancelledTax: formatDecimal(metrics.cancelledTax),
            netSales: formatDecimal(
              metrics.grossSales - metrics.returns - metrics.cancellations,
            ),
            collections: formatDecimal(metrics.collections),
            costOfGoodsSold: formatDecimal(metrics.costOfGoodsSold),
            grossProfit: formatDecimal(
              metrics.grossSales - metrics.salesTax -
                (metrics.returns - returnedTax) -
                (metrics.cancellations - metrics.cancelledTax) -
                metrics.costOfGoodsSold,
            ),
          })
        }
        for (const [date, metrics] of dailyForBranch) {
          if (
            metrics.purchaseCount !== 0 ||
            metrics.grossPurchases !== 0n ||
            metrics.purchaseReturns !== 0n
          ) {
            purchaseAnalytics.push({
              branch: data.branch.name,
              date,
              invoiceCount: metrics.purchaseCount,
              grossPurchases: formatDecimal(metrics.grossPurchases),
              returns: formatDecimal(metrics.purchaseReturns),
              netPurchases: formatDecimal(
                metrics.grossPurchases - metrics.purchaseReturns,
              ),
            })
          }
        }

        const orderIds = data.orders.map((order) => this.rowString(order.id))
        const [materials, costs] = await Promise.all([
          this.repository.listManufacturingMaterials(orderIds, transaction),
          this.repository.listManufacturingCosts(orderIds, transaction),
        ])
        const materialCostByOrder = new Map<string, bigint>()
        const additionalCostByOrder = new Map<string, bigint>()
        for (const material of materials) {
          const orderId = this.rowString(material.order_id)
          const materialCost = multiplyDecimal(
            this.decimal(material.consumed_quantity, 'Consumed quantity'),
            this.decimal(material.unit_cost, 'Material unit cost'),
          )
          materialCostByOrder.set(
            orderId,
            (materialCostByOrder.get(orderId) ?? 0n) + materialCost,
          )
        }
        for (const cost of costs) {
          const orderId = this.rowString(cost.order_id)
          additionalCostByOrder.set(
            orderId,
            (additionalCostByOrder.get(orderId) ?? 0n) +
              this.decimal(cost.amount, 'Production cost'),
          )
        }
        for (const order of data.orders) {
          const orderId = this.rowString(order.id)
          const materialCost = materialCostByOrder.get(orderId) ?? 0n
          const additionalCost = additionalCostByOrder.get(orderId) ?? 0n
          const totalCost = materialCost + additionalCost
          const output = this.decimal(order.actual_quantity, 'Actual output')
          const waste = this.decimal(order.waste_quantity, 'Production waste')
          totalProduction += output
          totalWaste += waste
          totalProductionCost += totalCost
          completedOrders += 1
          manufacturingReport.push({
            branch: data.branch.name,
            orderNumber: this.rowString(order.order_number),
            completedDate: this.rowString(order.completed_at).slice(0, 10),
            productSku: this.rowString(order.sku),
            product: this.rowString(order.product_name),
            status: this.rowString(order.status),
            plannedQuantity: this.rowString(order.planned_quantity),
            actualQuantity: formatDecimal(output),
            wasteQuantity: formatDecimal(waste),
            materialCost: formatDecimal(materialCost),
            additionalCost: formatDecimal(additionalCost),
            totalCost: formatDecimal(totalCost),
          })
        }
        metricsByBranch.set(data.branch.id, branchMetrics)
        totalCogs += branchMetrics.costOfGoodsSold
      }

      const balanceData = await this.getBalances(
        selectedBranches,
        to,
        transaction,
      )
      const inventoryByProduct = new Map<string, {
        branch: string
        sku: string
        name: string
        unit: string
        quantity: bigint
        minimumStock: bigint
        value: bigint
        warehouseTypes: Set<string>
      }>()
      let totalInventoryValue = 0n
      for (const branch of selectedBranches) {
        const warehouses = isOwner
          ? null
          : principal.warehouseIds
        const rows = await this.repository.listInventory(
          branch.id,
          warehouses,
          isOwner,
          transaction,
        )
        for (const row of rows) {
          const productId = this.rowString(row.product_id)
          const inventoryKey = `${branch.id}:${productId}`
          let product = inventoryByProduct.get(inventoryKey)
          if (!product) {
            product = {
              branch: branch.name,
              sku: this.rowString(row.sku),
              name: this.rowString(row.product_name),
              unit: this.rowString(row.unit_name),
              quantity: 0n,
              minimumStock: this.decimal(row.minimum_stock, 'Minimum stock'),
              value: 0n,
              warehouseTypes: new Set<string>(),
            }
            inventoryByProduct.set(inventoryKey, product)
          }
          const quantity = this.decimal(row.quantity, 'Inventory quantity')
          const value = multiplyDecimal(
            quantity,
            this.decimal(row.average_unit_cost, 'Average unit cost'),
          )
          product.quantity += quantity
          product.value += value
          product.warehouseTypes.add(
            typeof row.warehouse_type === 'string'
              ? row.warehouse_type
              : 'unknown',
          )
          totalInventoryValue += value
        }
      }
      const inventoryReport = Array.from(inventoryByProduct.values())
        .map((product) => ({
          branch: product.branch,
          sku: product.sku,
          product: product.name,
          quantity: formatDecimal(product.quantity),
          unit: product.unit,
          warehouseTypes: Array.from(product.warehouseTypes).join(','),
          minimumStock: formatDecimal(product.minimumStock),
          averageUnitCost: formatDecimal(
            product.quantity === 0n
              ? 0n
              : divideDecimal(product.value, product.quantity),
          ),
          inventoryValue: formatDecimal(product.value),
        }))
        .sort((left, right) => left.product.localeCompare(right.product))
      const lowStockReport = inventoryReport.filter((row) =>
        this.decimal(row.quantity, 'Inventory quantity') <=
        this.decimal(row.minimumStock, 'Minimum stock'),
      )

      const netSales = Array.from(metricsByBranch.values())
        .reduce((sum, metrics) =>
          sum + metrics.sales - metrics.salesReturns - metrics.salesCancellations,
        0n)
      const salesTax = Array.from(metricsByBranch.values())
        .reduce((sum, metrics) =>
          sum + metrics.salesTax - metrics.returnedTax - metrics.cancelledTax,
        0n)
      const netRevenue = netSales - salesTax
      const grossProfit = netRevenue - totalCogs
      const netProfit = grossProfit - totalExpenses
      const summary = {
        grossSales: formatDecimal(
          Array.from(metricsByBranch.values())
            .reduce((sum, metrics) => sum + metrics.sales, 0n),
        ),
        salesReturns: formatDecimal(
          Array.from(metricsByBranch.values())
            .reduce((sum, metrics) => sum + metrics.salesReturns, 0n),
        ),
        salesCancellations: formatDecimal(
          Array.from(metricsByBranch.values())
            .reduce((sum, metrics) => sum + metrics.salesCancellations, 0n),
        ),
        netSales: formatDecimal(netSales),
        netRevenueExcludingTax: formatDecimal(netRevenue),
        netSalesTax: formatDecimal(salesTax),
        netPurchases: formatDecimal(netPurchases),
        salesInvoiceCount: String(salesInvoiceCount),
        purchaseInvoiceCount: String(purchaseInvoiceCount),
        netCollections: formatDecimal(totalCollections),
        costOfGoodsSold: formatDecimal(totalCogs),
        grossProfit: formatDecimal(grossProfit),
        expenses: formatDecimal(totalExpenses),
        netProfit: formatDecimal(netProfit),
        inventoryValueCurrent: formatDecimal(totalInventoryValue),
        lowStockProductCount: String(
          new Set(lowStockReport.map((row) => String(row.sku))).size,
        ),
        customerReceivables: formatDecimal(balanceData.customerDue),
        supplierPayables: formatDecimal(balanceData.supplierDue),
        completedProductionOrders: String(completedOrders),
        actualProductionOutput: formatDecimal(totalProduction),
        productionWaste: formatDecimal(totalWaste),
        productionCost: formatDecimal(totalProductionCost),
      }
      const branchPerformance = selectedBranches.map((branch) => {
        const metrics = metricsByBranch.get(branch.id)
        const sales = metrics?.sales ?? 0n
        const returns = metrics?.salesReturns ?? 0n
        const cancellations = metrics?.salesCancellations ?? 0n
        const revenue = sales - returns - cancellations -
          ((metrics?.salesTax ?? 0n) - (metrics?.returnedTax ?? 0n) -
            (metrics?.cancelledTax ?? 0n))
        const cogs = metrics?.costOfGoodsSold ?? 0n
        const expenses = metrics?.expenses ?? 0n
        return {
          branchCode: branch.code,
          branch: branch.name,
          grossSales: formatDecimal(sales),
          salesReturns: formatDecimal(returns),
          netRevenue: formatDecimal(revenue),
          costOfGoodsSold: formatDecimal(cogs),
          expenses: formatDecimal(expenses),
          netProfit: formatDecimal(revenue - cogs - expenses),
        }
      })
      const profitAndLoss = [
        { line: 'Net revenue (excluding sales tax)', amount: formatDecimal(netRevenue) },
        { line: 'Cost of goods sold', amount: formatDecimal(-totalCogs) },
        { line: 'Gross profit', amount: formatDecimal(grossProfit) },
        { line: 'Operating expenses', amount: formatDecimal(-totalExpenses) },
        { line: 'Net profit', amount: formatDecimal(netProfit) },
      ]

      return {
        title: 'Business reports',
        period: {
          fromDate: parsed.data.fromDate,
          toDate: parsed.data.toDate,
        },
        branches: selectedBranches,
        accessibleBranches,
        summary,
        salesAnalytics: salesAnalytics.sort((a, b) =>
          String(a.date).localeCompare(String(b.date)) ||
          String(a.branch).localeCompare(String(b.branch)),
        ),
        purchaseAnalytics: purchaseAnalytics.sort((a, b) =>
          String(a.date).localeCompare(String(b.date)) ||
          String(a.branch).localeCompare(String(b.branch)),
        ),
        expenseReport,
        profitAndLoss,
        inventoryReport,
        lowStockReport,
        customerBalances: balanceData.customerBalances,
        supplierBalances: balanceData.supplierBalances,
        branchPerformance,
        manufacturingReport,
      }
    })
  }

  async exportExcel(actorId: string, input: unknown): Promise<Uint8Array> {
    return generateExcel(await this.getReports(actorId, input))
  }

  async exportPdf(actorId: string, input: unknown): Promise<Uint8Array> {
    return generatePdf(await this.getReports(actorId, input))
  }

  private async getBalances(
    branches: readonly Branch[],
    to: string,
    executor: SqlExecutor,
  ): Promise<{
    customerDue: bigint
    supplierDue: bigint
    customerBalances: ReportRow[]
    supplierBalances: ReportRow[]
  }> {
    const customerSales: SqlRow[] = []
    const customerReturns: SqlRow[] = []
    const customerPayments: SqlRow[] = []
    const supplierPurchases: SqlRow[] = []
    const supplierReturns: SqlRow[] = []
    const supplierPayments: SqlRow[] = []
    for (const branch of branches) {
      const [
        sales,
        returns,
        payments,
        purchases,
        purchaseReturnRows,
        purchasePaymentRows,
      ] = await Promise.all([
        this.repository.listCustomerSalesTo(branch.id, to, executor),
        this.repository.listCustomerReturnsTo(branch.id, to, executor),
        this.repository.listCustomerPaymentsTo(branch.id, to, executor),
        this.repository.listSupplierPurchasesTo(branch.id, to, executor),
        this.repository.listSupplierReturnsTo(branch.id, to, executor),
        this.repository.listSupplierPaymentsTo(branch.id, to, executor),
      ])
      customerSales.push(...sales)
      customerReturns.push(...returns)
      customerPayments.push(...payments)
      supplierPurchases.push(...purchases)
      supplierReturns.push(...purchaseReturnRows)
      supplierPayments.push(...purchasePaymentRows)
    }

    const salesById = new Map<string, { customerId: string; balance: bigint }>()
    const customerTotals = new Map<string, bigint>()
    for (const sale of customerSales) {
      const id = this.rowString(sale.id)
      const customerId = this.rowString(sale.customer_id)
      const balance = this.decimal(sale.total, 'Customer invoice total')
      salesById.set(id, { customerId, balance })
      customerTotals.set(customerId, (customerTotals.get(customerId) ?? 0n) + balance)
    }
    for (const returned of customerReturns) {
      const sale = salesById.get(this.rowString(returned.sale_id))
      if (!sale) continue
      customerTotals.set(
        sale.customerId,
        (customerTotals.get(sale.customerId) ?? 0n) -
          this.decimal(returned.refund_total, 'Customer refund'),
      )
    }
    for (const payment of customerPayments) {
      const sale = salesById.get(this.rowString(payment.sale_id))
      if (!sale) continue
      customerTotals.set(
        sale.customerId,
        (customerTotals.get(sale.customerId) ?? 0n) -
          this.signedDecimal(payment.amount, 'Customer collection'),
      )
    }
    const customers = await this.repository.listCustomers(
      Array.from(customerTotals.keys()),
      executor,
    )
    const customerBalances = customers.map((customer) => {
      const balance = customerTotals.get(this.rowString(customer.id)) ?? 0n
      return {
        code: this.rowString(customer.code),
        customer: this.rowString(customer.name),
        status: this.rowString(customer.status),
        amountDue: formatDecimal(balance > 0n ? balance : 0n),
        customerCredit: formatDecimal(balance < 0n ? -balance : 0n),
      }
    })

    const purchasesById = new Map<string, { supplierId: string }>()
    const supplierTotals = new Map<string, bigint>()
    for (const purchase of supplierPurchases) {
      const id = this.rowString(purchase.id)
      const supplierId = this.rowString(purchase.supplier_id)
      purchasesById.set(id, { supplierId })
      supplierTotals.set(
        supplierId,
        (supplierTotals.get(supplierId) ?? 0n) +
          this.decimal(purchase.total, 'Supplier invoice total'),
      )
    }
    for (const returned of supplierReturns) {
      const purchase = purchasesById.get(this.rowString(returned.purchase_id))
      if (!purchase) continue
      supplierTotals.set(
        purchase.supplierId,
        (supplierTotals.get(purchase.supplierId) ?? 0n) -
          this.decimal(returned.refund_total, 'Supplier refund'),
      )
    }
    for (const payment of supplierPayments) {
      const purchase = purchasesById.get(this.rowString(payment.purchase_id))
      if (!purchase) continue
      supplierTotals.set(
        purchase.supplierId,
        (supplierTotals.get(purchase.supplierId) ?? 0n) -
          this.signedDecimal(payment.amount, 'Supplier payment'),
      )
    }
    const suppliers = await this.repository.listSuppliers(
      Array.from(supplierTotals.keys()),
      executor,
    )
    const supplierBalances = suppliers.map((supplier) => {
      const balance = supplierTotals.get(this.rowString(supplier.id)) ?? 0n
      return {
        code: this.rowString(supplier.code),
        supplier: this.rowString(supplier.name),
        status: this.rowString(supplier.status),
        amountPayable: formatDecimal(balance > 0n ? balance : 0n),
        supplierCredit: formatDecimal(balance < 0n ? -balance : 0n),
      }
    })
    return {
      customerDue: Array.from(customerTotals.values())
        .reduce((sum, balance) => sum + (balance > 0n ? balance : 0n), 0n),
      supplierDue: Array.from(supplierTotals.values())
        .reduce((sum, balance) => sum + (balance > 0n ? balance : 0n), 0n),
      customerBalances,
      supplierBalances,
    }
  }

  private emptyDailyMetrics(): DailyMetrics {
    return {
      invoiceCount: 0,
      grossSales: 0n,
      salesTax: 0n,
      returns: 0n,
      returnedTax: 0n,
      cancellations: 0n,
      cancelledTax: 0n,
      collections: 0n,
      costOfGoodsSold: 0n,
      purchaseCount: 0,
      grossPurchases: 0n,
      purchaseReturns: 0n,
    }
  }

  private decimal(value: unknown, field: string): bigint {
    if (typeof value !== 'string') {
      throw new ReportsError(`The stored ${field.toLowerCase()} is invalid`)
    }
    try {
      return parseDecimal(value, field)
    } catch (error) {
      throw new ReportsError(`The stored ${field.toLowerCase()} is invalid`, {
        cause: error,
      })
    }
  }

  private signedDecimal(value: unknown, field: string): bigint {
    if (typeof value !== 'string') {
      throw new ReportsError(`The stored ${field.toLowerCase()} is invalid`)
    }
    return value.startsWith('-')
      ? -this.decimal(value.slice(1), field)
      : this.decimal(value, field)
  }

  private rowString(value: unknown): string {
    if (typeof value !== 'string') {
      throw new ReportsError('A report record contains invalid data')
    }
    return value
  }
}
