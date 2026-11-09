import type { SqlExecutor, SqlRow } from '../../infrastructure/database/types'

export class SalesRepository {
  private readonly database: SqlExecutor

  constructor(database: SqlExecutor) {
    this.database = database
  }

  async getWarehouse(
    warehouseId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT w.id, w.branch_id,
              CASE WHEN w.status = 'active' AND w.is_active = FALSE THEN 'inactive'
                   ELSE w.status END AS warehouse_status,
              b.status AS branch_status
       FROM warehouses w JOIN branches b ON b.id = w.branch_id
       WHERE w.id = ?`,
      [warehouseId],
    )
    return row ?? null
  }

  async getBranch(
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      'SELECT id, status FROM branches WHERE id = ?',
      [branchId],
    )
    return row ?? null
  }

  async getProduct(
    productId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, sku, name, base_unit_id, selling_price, status
       FROM products WHERE id = ?`,
      [productId],
    )
    return row ?? null
  }

  async getUnit(
    productId: string,
    unitId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT u.id, u.name, u.decimal_places,
              CASE WHEN u.id = p.base_unit_id THEN '1'
                   ELSE puc.factor_to_base END AS factor_to_base
       FROM products p
       JOIN measurement_units u ON u.id = ?
       LEFT JOIN product_unit_conversions puc
         ON puc.product_id = p.id AND puc.unit_id = u.id
       WHERE p.id = ? AND p.status = 'active' AND u.status = 'active'
         AND (u.id = p.base_unit_id OR puc.unit_id IS NOT NULL)`,
      [unitId, productId],
    )
    return row ?? null
  }

  async searchProducts(
    query: string,
    warehouseId: string,
    limit: number,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    const pattern = `%${query}%`
    return executor.query(
      `SELECT p.id, p.sku, p.name, p.base_unit_id, a.selling_price,
              u.name AS base_unit_name, COALESCE(ib.on_hand_quantity, '0') AS stock,
              (SELECT pb.barcode FROM product_barcodes pb
               WHERE pb.product_id = p.id AND pb.barcode = ? LIMIT 1) AS barcode,
              (SELECT pb.unit_id FROM product_barcodes pb
               WHERE pb.product_id = p.id AND pb.barcode = ? LIMIT 1) AS barcode_unit_id
       FROM products p
       JOIN warehouses w ON w.id = ? AND w.status = 'active' AND w.is_active = TRUE
       JOIN product_branch_availability a
         ON a.product_id = p.id AND a.branch_id = w.branch_id AND a.status = 'active'
       JOIN measurement_units u ON u.id = p.base_unit_id
       LEFT JOIN inventory_balances ib
         ON ib.product_id = p.id AND ib.warehouse_id = ?
       WHERE p.status = 'active'
         AND (? = '' OR LOWER(p.name) LIKE LOWER(?)
              OR LOWER(p.sku) LIKE LOWER(?)
              OR EXISTS (SELECT 1 FROM product_barcodes pb
                         WHERE pb.product_id = p.id AND pb.barcode = ?))
       ORDER BY CASE WHEN EXISTS (
         SELECT 1 FROM product_barcodes pb
         WHERE pb.product_id = p.id AND pb.barcode = ?
       ) THEN 0 ELSE 1 END, p.name, p.sku
       LIMIT ?`,
      [query, query, warehouseId, warehouseId, query, pattern, pattern, query, query, limit],
    )
  }

  async listUnits(
    productId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT u.id, u.code, u.name, u.decimal_places,
              CASE WHEN u.id = p.base_unit_id THEN '1'
                   ELSE puc.factor_to_base END AS factor_to_base
       FROM products p
       JOIN measurement_units u ON u.status = 'active'
       LEFT JOIN product_unit_conversions puc
         ON puc.product_id = p.id AND puc.unit_id = u.id
       WHERE p.id = ? AND p.status = 'active'
         AND (u.id = p.base_unit_id OR puc.unit_id IS NOT NULL)
       ORDER BY CASE WHEN u.id = p.base_unit_id THEN 0 ELSE 1 END, u.name`,
      [productId],
    )
  }

  async listCustomers(
    search: string,
    limit: number,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    const pattern = `%${search}%`
    return executor.query(
      `SELECT id, code, name, phone, email
       FROM customers
       WHERE status = 'active'
         AND (? = '' OR LOWER(name) LIKE LOWER(?)
              OR LOWER(code) LIKE LOWER(?) OR phone LIKE ?)
       ORDER BY name, code LIMIT ?`,
      [search, pattern, pattern, pattern, limit],
    )
  }

  async getCustomer(
    customerId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, code, name, phone, email
       FROM customers WHERE id = ? AND status = 'active'`,
      [customerId],
    )
    return row ?? null
  }

  async getTaxSetting(
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<{ taxRate: string; taxMode: 'exclusive' | 'inclusive' }> {
    const [row] = await executor.query<{
      tax_rate: string
      tax_mode: 'exclusive' | 'inclusive'
    }>(
      'SELECT tax_rate, tax_mode FROM sales_tax_settings WHERE branch_id = ?',
      [branchId],
    )
    return {
      taxRate: row?.tax_rate ?? '0',
      taxMode: row?.tax_mode ?? 'exclusive',
    }
  }

  async setTaxSetting(
    input: {
      branchId: string
      taxRate: string
      taxMode: 'exclusive' | 'inclusive'
      actorId: string
      updatedAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO sales_tax_settings
         (branch_id, tax_rate, tax_mode, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(branch_id) DO UPDATE SET
         tax_rate = excluded.tax_rate,
         tax_mode = excluded.tax_mode,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
      [
        input.branchId,
        input.taxRate,
        input.taxMode,
        input.actorId,
        input.updatedAt,
      ],
    )
  }

  async getSaleCount(
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<number> {
    const [row] = await executor.query<{ sale_count: number }>(
      'SELECT COUNT(*) AS sale_count FROM sales WHERE branch_id = ?',
      [branchId],
    )
    return Number(row?.sale_count ?? 0)
  }

  async createSale(
    input: {
      id: string
      branchId: string
      warehouseId: string
      customerId: string | null
      invoiceNumber: string
      subtotal: string
      discountTotal: string
      taxTotal: string
      taxRate: string
      taxMode: 'exclusive' | 'inclusive'
      total: string
      notes: string | null
      actorId: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO sales
         (id, branch_id, warehouse_id, customer_id, invoice_number, status,
          subtotal, discount_total, tax_total, tax_rate, tax_mode, total,
          notes, created_by,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.branchId,
        input.warehouseId,
        input.customerId,
        input.invoiceNumber,
        input.subtotal,
        input.discountTotal,
        input.taxTotal,
        input.taxRate,
        input.taxMode,
        input.total,
        input.notes,
        input.actorId,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async addSaleItem(
    input: {
      id: string
      saleId: string
      productId: string
      unitId: string
      quantity: string
      unitPrice: string
      discountTotal: string
      taxTotal: string
      lineTotal: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO sale_items
         (id, sale_id, product_id, unit_id, quantity, unit_price,
          discount_total, tax_total, line_total, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.saleId,
        input.productId,
        input.unitId,
        input.quantity,
        input.unitPrice,
        input.discountTotal,
        input.taxTotal,
        input.lineTotal,
        input.createdAt,
      ],
    )
  }

  async addSalePayment(
    input: {
      id: string
      saleId: string
      amount: string
      paymentMethod: string
      reference: string | null
      actorId: string
      paidAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO sale_payments
         (id, sale_id, amount, payment_method, reference, received_by,
          paid_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.saleId,
        input.amount,
        input.paymentMethod,
        input.reference,
        input.actorId,
        input.paidAt,
        input.paidAt,
      ],
    )
  }

  async getSale(
    saleId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT s.id, s.branch_id, s.warehouse_id, s.customer_id,
              s.invoice_number, s.status, s.subtotal, s.discount_total,
              s.tax_total, s.tax_rate, s.tax_mode, s.total, s.notes,
              s.created_by, s.created_at,
              s.updated_at, c.name AS customer_name
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ?`,
      [saleId],
    )
    return row ?? null
  }

  async listSales(
    branchId: string,
    limit: number,
    offset: number,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT s.id, s.branch_id, s.warehouse_id, s.customer_id,
              s.invoice_number, s.status, s.subtotal, s.discount_total,
              s.tax_total, s.tax_rate, s.tax_mode, s.total, s.notes, s.created_at,
              c.name AS customer_name
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.branch_id = ?
       ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`,
      [branchId, limit, offset],
    )
  }

  async getSaleItems(
    saleId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT si.id, si.product_id, p.sku, p.name AS product_name,
              si.unit_id, u.name AS unit_name, si.quantity, si.unit_price,
              si.discount_total, si.tax_total, si.line_total, p.base_unit_id
       FROM sale_items si JOIN products p ON p.id = si.product_id
       JOIN measurement_units u ON u.id = si.unit_id
       WHERE si.sale_id = ? ORDER BY si.created_at, si.id`,
      [saleId],
    )
  }

  async getSaleItem(
    saleItemId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT si.id, si.sale_id, si.product_id, si.unit_id, si.quantity,
              si.unit_price, si.discount_total, si.tax_total, si.line_total,
              p.base_unit_id
       FROM sale_items si JOIN products p ON p.id = si.product_id
       WHERE si.id = ?`,
      [saleItemId],
    )
    return row ?? null
  }

  async getSalePayments(
    saleId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, amount, payment_method, reference, received_by, paid_at
       FROM sale_payments WHERE sale_id = ? ORDER BY paid_at, id`,
      [saleId],
    )
  }

  async createReturn(
    input: {
      id: string
      saleId: string
      returnNumber: string
      reason: string
      refundTotal: string
      actorId: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO sales_returns
         (id, sale_id, return_number, status, reason, refund_total,
          created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'posted', ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.saleId,
        input.returnNumber,
        input.reason,
        input.refundTotal,
        input.actorId,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async addReturnItem(
    input: {
      id: string
      returnId: string
      saleItemId: string
      quantity: string
      refundAmount: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO sales_return_items
         (id, return_id, sale_item_id, quantity, refund_amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.returnId,
        input.saleItemId,
        input.quantity,
        input.refundAmount,
        input.createdAt,
      ],
    )
  }

  async listReturnsForSaleItem(
    saleItemId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT sri.quantity, sri.refund_amount
       FROM sales_return_items sri JOIN sales_returns sr ON sr.id = sri.return_id
       WHERE sri.sale_item_id = ? AND sr.status = 'posted'
       ORDER BY sri.created_at, sri.id`,
      [saleItemId],
    )
  }

  async listReturnItemsForSale(
    saleId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT sri.sale_item_id, sri.quantity
       FROM sales_return_items sri
       JOIN sales_returns sr ON sr.id = sri.return_id
       WHERE sr.sale_id = ? AND sr.status = 'posted'`,
      [saleId],
    )
  }

  async updateSaleStatus(
    saleId: string,
    status: 'partially_returned' | 'returned' | 'cancelled',
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      'UPDATE sales SET status = ?, updated_at = ? WHERE id = ?',
      [status, updatedAt, saleId],
    )
  }

  async listReturns(
    saleId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, return_number, status, reason, refund_total,
              created_by, created_at
       FROM sales_returns WHERE sale_id = ? ORDER BY created_at, id`,
      [saleId],
    )
  }

  async listReturnItems(
    returnId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT sri.id, sri.sale_item_id, sri.quantity, sri.refund_amount,
              si.product_id, p.sku, p.name AS product_name
       FROM sales_return_items sri
       JOIN sale_items si ON si.id = sri.sale_item_id
       JOIN products p ON p.id = si.product_id
       WHERE sri.return_id = ?
       ORDER BY sri.created_at, sri.id`,
      [returnId],
    )
  }
}
