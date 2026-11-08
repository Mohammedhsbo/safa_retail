import type { SqlExecutor, SqlRow } from '../../infrastructure/database/types'

export class PurchasesRepository {
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

  async listSuppliers(
    search: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    const pattern = `%${search}%`
    return executor.query(
      `SELECT id, code, name, phone, email, address, notes, status,
              created_at, updated_at
       FROM suppliers
       WHERE (? = '' OR LOWER(name) LIKE LOWER(?)
              OR LOWER(code) LIKE LOWER(?) OR phone LIKE ?)
       ORDER BY name, code`,
      [search, pattern, pattern, pattern],
    )
  }

  async getSupplier(
    supplierId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, code, name, phone, email, address, notes, status,
              created_at, updated_at
       FROM suppliers WHERE id = ?`,
      [supplierId],
    )
    return row ?? null
  }

  async createSupplier(
    input: {
      id: string
      code: string
      name: string
      phone: string | null
      email: string | null
      address: string | null
      notes: string | null
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO suppliers
         (id, code, name, phone, email, address, notes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        input.id,
        input.code,
        input.name,
        input.phone,
        input.email,
        input.address,
        input.notes,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async updateSupplier(
    supplierId: string,
    input: {
      code: string
      name: string
      phone: string | null
      email: string | null
      address: string | null
      notes: string | null
    },
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `UPDATE suppliers
       SET code = ?, name = ?, phone = ?, email = ?, address = ?, notes = ?,
           updated_at = ?
       WHERE id = ? AND status = 'active'`,
      [
        input.code,
        input.name,
        input.phone,
        input.email,
        input.address,
        input.notes,
        updatedAt,
        supplierId,
      ],
    )
  }

  async archiveSupplier(
    supplierId: string,
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      "UPDATE suppliers SET status = 'archived', updated_at = ? WHERE id = ? AND status = 'active'",
      [updatedAt, supplierId],
    )
  }

  async countPurchasesForBranch(
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<number> {
    const [row] = await executor.query<{ purchase_count: number }>(
      'SELECT COUNT(*) AS purchase_count FROM purchases WHERE branch_id = ?',
      [branchId],
    )
    return Number(row?.purchase_count ?? 0)
  }

  async countReturns(
    purchaseId: string,
    executor: SqlExecutor = this.database,
  ): Promise<number> {
    const [row] = await executor.query<{ return_count: number }>(
      'SELECT COUNT(*) AS return_count FROM purchase_returns WHERE purchase_id = ?',
      [purchaseId],
    )
    return Number(row?.return_count ?? 0)
  }

  async createPurchase(
    input: {
      id: string
      branchId: string
      warehouseId: string
      supplierId: string
      invoiceNumber: string
      supplierInvoiceNumber: string | null
      subtotal: string
      discountTotal: string
      total: string
      notes: string | null
      actorId: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO purchases
         (id, branch_id, warehouse_id, supplier_id, invoice_number,
          supplier_invoice_number, status, subtotal, discount_total, tax_total,
          total, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, '0', ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.branchId,
        input.warehouseId,
        input.supplierId,
        input.invoiceNumber,
        input.supplierInvoiceNumber,
        input.subtotal,
        input.discountTotal,
        input.total,
        input.notes,
        input.actorId,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async addPurchaseItem(
    input: {
      id: string
      purchaseId: string
      productId: string
      unitId: string
      quantity: string
      unitCost: string
      discountTotal: string
      lineTotal: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO purchase_items
         (id, purchase_id, product_id, unit_id, quantity, unit_cost,
          discount_total, tax_total, line_total, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '0', ?, ?)`,
      [
        input.id,
        input.purchaseId,
        input.productId,
        input.unitId,
        input.quantity,
        input.unitCost,
        input.discountTotal,
        input.lineTotal,
        input.createdAt,
      ],
    )
  }

  async getPurchase(
    purchaseId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT p.id, p.branch_id, p.warehouse_id, p.supplier_id,
              p.invoice_number, p.supplier_invoice_number, p.status,
              p.subtotal, p.discount_total, p.tax_total, p.total, p.notes,
              p.created_by, p.received_at, p.created_at, p.updated_at,
              s.code AS supplier_code, s.name AS supplier_name
       FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.id = ?`,
      [purchaseId],
    )
    return row ?? null
  }

  async listPurchases(
    branchId: string,
    limit: number,
    offset: number,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT p.id, p.branch_id, p.warehouse_id, p.supplier_id,
              p.invoice_number, p.supplier_invoice_number, p.status,
              p.subtotal, p.discount_total, p.tax_total, p.total, p.notes,
              p.created_by, p.received_at, p.created_at, p.updated_at,
              s.code AS supplier_code, s.name AS supplier_name
       FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.branch_id = ?
       ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`,
      [branchId, limit, offset],
    )
  }

  async getPurchaseItems(
    purchaseId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT pi.id, pi.product_id, p.sku, p.name AS product_name,
              pi.unit_id, u.name AS unit_name, pi.quantity, pi.unit_cost,
              pi.discount_total, pi.tax_total, pi.line_total
       FROM purchase_items pi JOIN products p ON p.id = pi.product_id
       JOIN measurement_units u ON u.id = pi.unit_id
       WHERE pi.purchase_id = ? ORDER BY pi.created_at, pi.id`,
      [purchaseId],
    )
  }

  async getPurchaseItem(
    purchaseItemId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT pi.id, pi.purchase_id, pi.product_id, pi.unit_id, pi.quantity,
              pi.unit_cost, pi.discount_total, pi.line_total
       FROM purchase_items pi WHERE pi.id = ?`,
      [purchaseItemId],
    )
    return row ?? null
  }

  async receivePurchase(
    purchaseId: string,
    receivedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `UPDATE purchases SET status = 'received', received_at = ?,
              updated_at = ? WHERE id = ? AND status = 'draft'`,
      [receivedAt, receivedAt, purchaseId],
    )
  }

  async addPayment(
    input: {
      id: string
      purchaseId: string
      amount: string
      method: string
      reference: string | null
      actorId: string
      paidAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO purchase_payments
         (id, purchase_id, amount, payment_method, reference, paid_by,
          paid_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.purchaseId,
        input.amount,
        input.method,
        input.reference,
        input.actorId,
        input.paidAt,
        input.paidAt,
      ],
    )
  }

  async getPayments(
    purchaseId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, amount, payment_method, reference, paid_by, paid_at
       FROM purchase_payments WHERE purchase_id = ? ORDER BY paid_at, id`,
      [purchaseId],
    )
  }

  async createReturn(
    input: {
      id: string
      purchaseId: string
      returnNumber: string
      reason: string
      refundTotal: string
      actorId: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO purchase_returns
         (id, purchase_id, return_number, status, reason, refund_total,
          created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'posted', ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.purchaseId,
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
      purchaseItemId: string
      quantity: string
      refundAmount: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO purchase_return_items
         (id, return_id, purchase_item_id, quantity, refund_amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.returnId,
        input.purchaseItemId,
        input.quantity,
        input.refundAmount,
        input.createdAt,
      ],
    )
  }

  async getReturns(
    purchaseId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, return_number, status, reason, refund_total, created_by, created_at
       FROM purchase_returns WHERE purchase_id = ? ORDER BY created_at, id`,
      [purchaseId],
    )
  }

  async listReturnsForPurchaseItem(
    purchaseItemId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT pri.quantity, pri.refund_amount
       FROM purchase_return_items pri
       JOIN purchase_returns pr ON pr.id = pri.return_id
       WHERE pri.purchase_item_id = ? AND pr.status = 'posted'`,
      [purchaseItemId],
    )
  }

  async updatePurchaseStatus(
    purchaseId: string,
    status: 'partially_returned' | 'returned',
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      'UPDATE purchases SET status = ?, updated_at = ? WHERE id = ?',
      [status, updatedAt, purchaseId],
    )
  }

  async listStatementPurchases(
    supplierId: string,
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, invoice_number, supplier_invoice_number, status, total,
              created_at, received_at
       FROM purchases
       WHERE supplier_id = ? AND branch_id = ?
       ORDER BY created_at, id`,
      [supplierId, branchId],
    )
  }

  async listSupplierReturns(
    supplierId: string,
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT pr.id, pr.return_number, pr.reason, pr.refund_total, pr.created_at,
              p.id AS purchase_id, p.invoice_number
       FROM purchase_returns pr
       JOIN purchases p ON p.id = pr.purchase_id
       WHERE p.supplier_id = ? AND p.branch_id = ? AND pr.status = 'posted'
       ORDER BY pr.created_at, pr.id`,
      [supplierId, branchId],
    )
  }

  async listSupplierPayments(
    supplierId: string,
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT pp.id, pp.purchase_id, pp.amount, pp.payment_method,
              pp.reference, pp.paid_at, p.invoice_number
       FROM purchase_payments pp JOIN purchases p ON p.id = pp.purchase_id
       WHERE p.supplier_id = ? AND p.branch_id = ?
       ORDER BY pp.paid_at, pp.id`,
      [supplierId, branchId],
    )
  }

  async supplierHasPurchases(
    supplierId: string,
    executor: SqlExecutor = this.database,
  ): Promise<boolean> {
    const [row] = await executor.query<{ exists: number }>(
      'SELECT EXISTS(SELECT 1 FROM purchases WHERE supplier_id = ?) AS exists',
      [supplierId],
    )
    return Number(row?.exists ?? 0) === 1
  }
}
