import type { SqlExecutor, SqlRow } from '../../infrastructure/database/types'

export class ReportsRepository {
  private readonly database: SqlExecutor

  constructor(database: SqlExecutor) {
    this.database = database
  }

  async listAccessibleBranches(
    branchIds: readonly string[] | null,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    if (branchIds?.length === 0) return []
    const filter = branchIds
      ? `AND id IN (${branchIds.map(() => '?').join(', ')})`
      : ''
    return executor.query(
      `SELECT id, code, name FROM branches
       WHERE status = 'active' ${filter} ORDER BY name, code`,
      branchIds ?? [],
    )
  }

  async listSales(
    branchId: string,
    from: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, invoice_number, status, subtotal, discount_total, tax_total,
              total, created_at
       FROM sales
       WHERE branch_id = ? AND created_at >= ? AND created_at <= ?
         AND status IN ('posted', 'partially_returned', 'returned', 'cancelled')
       ORDER BY created_at, id`,
      [branchId, from, to],
    )
  }

  async listSalesCancellations(
    branchId: string,
    from: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, total, tax_total, updated_at
       FROM sales
       WHERE branch_id = ? AND status = 'cancelled'
         AND updated_at >= ? AND updated_at <= ?
       ORDER BY updated_at, id`,
      [branchId, from, to],
    )
  }

  async listSalesReturns(
    branchId: string,
    from: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT sr.id, sr.sale_id, sr.return_number, sr.refund_total, sr.created_at
       FROM sales_returns sr JOIN sales s ON s.id = sr.sale_id
       WHERE s.branch_id = ? AND sr.status = 'posted'
         AND sr.created_at >= ? AND sr.created_at <= ?
         AND s.status IN ('posted', 'partially_returned', 'returned')
       ORDER BY sr.created_at, sr.id`,
      [branchId, from, to],
    )
  }

  async listSalesReturnItems(
    branchId: string,
    from: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT sri.refund_amount, si.tax_total, si.line_total,
              sr.created_at AS returned_at
       FROM sales_return_items sri
       JOIN sales_returns sr ON sr.id = sri.return_id
       JOIN sales s ON s.id = sr.sale_id
       JOIN sale_items si ON si.id = sri.sale_item_id
       WHERE s.branch_id = ? AND sr.status = 'posted'
         AND sr.created_at >= ? AND sr.created_at <= ?
         AND s.status IN ('posted', 'partially_returned', 'returned')`,
      [branchId, from, to],
    )
  }

  async listSaleMovements(
    branchId: string,
    from: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT m.movement_type, m.quantity, m.unit_cost, m.occurred_at
       FROM inventory_movements m
       JOIN warehouses w ON w.id = m.warehouse_id
       WHERE w.branch_id = ? AND m.occurred_at >= ? AND m.occurred_at <= ?
         AND m.movement_type IN ('sale_out', 'sale_return_in', 'sale_cancel_in')
       ORDER BY m.occurred_at, m.id`,
      [branchId, from, to],
    )
  }

  async listSalePayments(
    branchId: string,
    from: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT sp.id, sp.amount, sp.paid_at
       FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
       WHERE s.branch_id = ? AND sp.paid_at >= ? AND sp.paid_at <= ?
       ORDER BY sp.paid_at, sp.id`,
      [branchId, from, to],
    )
  }

  async listPurchases(
    branchId: string,
    from: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, invoice_number, supplier_id, status, subtotal,
              discount_total, tax_total, total, received_at
       FROM purchases
       WHERE branch_id = ? AND received_at >= ? AND received_at <= ?
         AND status IN ('received', 'partially_returned', 'returned')
       ORDER BY received_at, id`,
      [branchId, from, to],
    )
  }

  async listPurchaseReturns(
    branchId: string,
    from: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT pr.id, pr.purchase_id, pr.return_number, pr.refund_total, pr.created_at
       FROM purchase_returns pr JOIN purchases p ON p.id = pr.purchase_id
       WHERE p.branch_id = ? AND pr.status = 'posted'
         AND pr.created_at >= ? AND pr.created_at <= ?
       ORDER BY pr.created_at, pr.id`,
      [branchId, from, to],
    )
  }

  async listExpenses(
    branchId: string,
    from: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, category, amount, description, incurred_at
       FROM expenses
       WHERE branch_id = ? AND status = 'posted'
         AND incurred_at >= ? AND incurred_at <= ?
       ORDER BY incurred_at, id`,
      [branchId, from, to],
    )
  }

  async listInventory(
    branchId: string,
    warehouseIds: readonly string[] | null,
    includeArchived: boolean,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    if (warehouseIds?.length === 0) return []
    const warehouseFilter = warehouseIds
      ? `AND w.id IN (${warehouseIds.map(() => '?').join(', ')})`
      : ''
    const warehouseStatus = includeArchived
      ? ''
      : "AND w.status = 'active' AND w.is_active = TRUE"
    return executor.query(
      `SELECT p.id AS product_id, p.sku, p.name AS product_name,
              a.minimum_stock, p.base_unit_id, u.name AS unit_name,
              w.id AS warehouse_id, w.code AS warehouse_code,
              w.warehouse_type,
              COALESCE(ib.on_hand_quantity, '0') AS quantity,
              COALESCE(ib.average_unit_cost, '0') AS average_unit_cost
       FROM products p
       JOIN measurement_units u ON u.id = p.base_unit_id
       JOIN warehouses w ON w.branch_id = ? ${warehouseStatus}
       JOIN branches b ON b.id = w.branch_id AND b.status = 'active'
       JOIN product_branch_availability a
         ON a.product_id = p.id AND a.branch_id = w.branch_id
       LEFT JOIN inventory_balances ib
         ON ib.product_id = p.id AND ib.warehouse_id = w.id
       WHERE (p.status = 'active' OR ib.product_id IS NOT NULL)
         AND (a.status = 'active' OR ib.product_id IS NOT NULL) ${warehouseFilter}
       ORDER BY p.name, w.code`,
      [branchId, ...(warehouseIds ?? [])],
    )
  }

  async listCustomerSalesTo(
    branchId: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT s.id, s.customer_id, s.status, s.total, s.created_at
       FROM sales s
       WHERE s.branch_id = ? AND s.customer_id IS NOT NULL
         AND s.created_at <= ?
         AND (
           s.status IN ('posted', 'partially_returned', 'returned') OR
           (s.status = 'cancelled' AND s.updated_at > ?)
         )
       ORDER BY s.created_at, s.id`,
      [branchId, to, to],
    )
  }

  async listCustomerReturnsTo(
    branchId: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT sr.sale_id, sr.refund_total
       FROM sales_returns sr JOIN sales s ON s.id = sr.sale_id
       WHERE s.branch_id = ? AND sr.status = 'posted' AND sr.created_at <= ?
         AND (
           s.status IN ('posted', 'partially_returned', 'returned') OR
           (s.status = 'cancelled' AND s.updated_at > ?)
         )`,
      [branchId, to, to],
    )
  }

  async listCustomerPaymentsTo(
    branchId: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT sp.sale_id, sp.amount
       FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
       WHERE s.branch_id = ? AND s.customer_id IS NOT NULL
         AND sp.paid_at <= ?
         AND (
           s.status IN ('posted', 'partially_returned', 'returned') OR
           (s.status = 'cancelled' AND s.updated_at > ?)
         )`,
      [branchId, to, to],
    )
  }

  async listCustomers(
    customerIds: readonly string[],
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    if (customerIds.length === 0) return []
    return executor.query(
      `SELECT id, code, name, status FROM customers
       WHERE id IN (${customerIds.map(() => '?').join(', ')})
       ORDER BY name, code`,
      customerIds,
    )
  }

  async listSupplierPurchasesTo(
    branchId: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT p.id, p.supplier_id, p.status, p.total, p.received_at
       FROM purchases p WHERE p.branch_id = ? AND p.received_at <= ?
         AND (
           p.status IN ('received', 'partially_returned', 'returned') OR
           (p.status = 'cancelled' AND p.updated_at > ?)
         )
       ORDER BY p.received_at, p.id`,
      [branchId, to, to],
    )
  }

  async listSupplierReturnsTo(
    branchId: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT pr.purchase_id, pr.refund_total
       FROM purchase_returns pr JOIN purchases p ON p.id = pr.purchase_id
      WHERE p.branch_id = ? AND pr.status = 'posted' AND pr.created_at <= ?
        AND (
          p.status IN ('received', 'partially_returned', 'returned') OR
          (p.status = 'cancelled' AND p.updated_at > ?)
        )`,
      [branchId, to, to],
    )
  }

  async listSupplierPaymentsTo(
    branchId: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT pp.purchase_id, pp.amount
       FROM purchase_payments pp JOIN purchases p ON p.id = pp.purchase_id
       WHERE p.branch_id = ? AND pp.paid_at <= ?
         AND (
           p.status IN ('received', 'partially_returned', 'returned') OR
           (p.status = 'cancelled' AND p.updated_at > ?)
         )`,
      [branchId, to, to],
    )
  }

  async listSuppliers(
    supplierIds: readonly string[],
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    if (supplierIds.length === 0) return []
    return executor.query(
      `SELECT id, code, name, status FROM suppliers
       WHERE id IN (${supplierIds.map(() => '?').join(', ')})
       ORDER BY name, code`,
      supplierIds,
    )
  }

  async listManufacturingOrders(
    branchId: string,
    from: string,
    to: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT mo.id, mo.order_number, mo.finished_product_id,
              p.sku, p.name AS product_name, mo.planned_quantity,
              mo.actual_quantity, mo.waste_quantity, mo.status, mo.completed_at
       FROM manufacturing_orders mo
       JOIN products p ON p.id = mo.finished_product_id
       WHERE mo.branch_id = ? AND mo.completed_at >= ? AND mo.completed_at <= ?
         AND mo.status IN ('completed', 'approved')
       ORDER BY mo.completed_at, mo.id`,
      [branchId, from, to],
    )
  }

  async listManufacturingMaterials(
    orderIds: readonly string[],
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    if (orderIds.length === 0) return []
    return executor.query(
      `SELECT order_id, consumed_quantity, unit_cost
       FROM manufacturing_materials
       WHERE order_id IN (${orderIds.map(() => '?').join(', ')})
         AND consumed_quantity IS NOT NULL AND unit_cost IS NOT NULL`,
      orderIds,
    )
  }

  async listManufacturingCosts(
    orderIds: readonly string[],
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    if (orderIds.length === 0) return []
    return executor.query(
      `SELECT order_id, amount FROM manufacturing_costs
       WHERE order_id IN (${orderIds.map(() => '?').join(', ')})`,
      orderIds,
    )
  }
}
