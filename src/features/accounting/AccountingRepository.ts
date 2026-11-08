import type { SqlExecutor, SqlRow } from '../../infrastructure/database/types'

export class AccountingRepository {
  private readonly database: SqlExecutor

  constructor(database: SqlExecutor) {
    this.database = database
  }

  async listCustomers(
    search: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    const pattern = `%${search}%`
    return executor.query(
      `SELECT id, code, name, phone, email, address, notes, status,
              created_at, updated_at
       FROM customers
       WHERE (? = '' OR LOWER(name) LIKE LOWER(?)
              OR LOWER(code) LIKE LOWER(?) OR phone LIKE ?)
       ORDER BY name, code`,
      [search, pattern, pattern, pattern],
    )
  }

  async getCustomer(
    customerId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, code, name, phone, email, address, notes, status,
              created_at, updated_at
       FROM customers WHERE id = ?`,
      [customerId],
    )
    return row ?? null
  }

  async createCustomer(
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
      `INSERT INTO customers
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

  async updateCustomer(
    customerId: string,
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
      `UPDATE customers SET code = ?, name = ?, phone = ?, email = ?,
              address = ?, notes = ?, updated_at = ?
       WHERE id = ? AND status = 'active'`,
      [
        input.code,
        input.name,
        input.phone,
        input.email,
        input.address,
        input.notes,
        updatedAt,
        customerId,
      ],
    )
  }

  async archiveCustomer(
    customerId: string,
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      "UPDATE customers SET status = 'archived', updated_at = ? WHERE id = ? AND status = 'active'",
      [updatedAt, customerId],
    )
  }

  async listCustomerSales(
    customerId: string,
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, invoice_number, status, total, created_at
       FROM sales
       WHERE customer_id = ? AND branch_id = ?
       ORDER BY created_at, id`,
      [customerId, branchId],
    )
  }

  async listCustomerReturns(
    customerId: string,
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT sr.id, sr.return_number, sr.reason, sr.refund_total,
              sr.created_at, s.invoice_number
       FROM sales_returns sr
       JOIN sales s ON s.id = sr.sale_id
       WHERE s.customer_id = ? AND s.branch_id = ? AND sr.status = 'posted'
       ORDER BY sr.created_at, sr.id`,
      [customerId, branchId],
    )
  }

  async listCustomerPayments(
    customerId: string,
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT sp.id, sp.sale_id, sp.amount, sp.payment_method, sp.reference,
              sp.paid_at, s.invoice_number, s.status AS sale_status
       FROM sale_payments sp
       JOIN sales s ON s.id = sp.sale_id
       WHERE s.customer_id = ? AND s.branch_id = ?
       ORDER BY sp.paid_at, sp.id`,
      [customerId, branchId],
    )
  }

  async getSale(
    saleId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, branch_id, customer_id, invoice_number, status, total
       FROM sales WHERE id = ?`,
      [saleId],
    )
    return row ?? null
  }

  async listSaleReturns(
    saleId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT refund_total FROM sales_returns
       WHERE sale_id = ? AND status = 'posted'`,
      [saleId],
    )
  }

  async listSalePayments(
    saleId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      'SELECT amount FROM sale_payments WHERE sale_id = ? ORDER BY paid_at, id',
      [saleId],
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
         (id, sale_id, amount, payment_method, reference, received_by, paid_at, created_at)
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

  async listCashboxes(
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT c.id, c.branch_id, c.code, c.name, c.status,
              c.created_at, c.updated_at, b.name AS branch_name
       FROM cashboxes c JOIN branches b ON b.id = c.branch_id
       WHERE c.branch_id = ? ORDER BY c.code`,
      [branchId],
    )
  }

  async getCashbox(
    cashboxId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT c.id, c.branch_id, c.code, c.name, c.status,
              c.created_at, c.updated_at, b.status AS branch_status
       FROM cashboxes c JOIN branches b ON b.id = c.branch_id
       WHERE c.id = ?`,
      [cashboxId],
    )
    return row ?? null
  }

  async createCashbox(
    input: {
      id: string
      branchId: string
      code: string
      name: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO cashboxes
         (id, branch_id, code, name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      [
        input.id,
        input.branchId,
        input.code,
        input.name,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async archiveCashbox(
    cashboxId: string,
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      "UPDATE cashboxes SET status = 'archived', updated_at = ? WHERE id = ? AND status = 'active'",
      [updatedAt, cashboxId],
    )
  }

  async listCashMovements(
    cashboxId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, movement_type, amount, source_type, source_id,
              occurred_at, created_by
       FROM cash_movements WHERE cashbox_id = ?
       ORDER BY occurred_at, id`,
      [cashboxId],
    )
  }

  async addCashMovement(
    input: {
      id: string
      cashboxId: string
      movementType: string
      amount: string
      sourceType: string
      sourceId: string
      actorId: string
      occurredAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO cash_movements
         (id, cashbox_id, movement_type, amount, source_type, source_id,
          occurred_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.cashboxId,
        input.movementType,
        input.amount,
        input.sourceType,
        input.sourceId,
        input.occurredAt,
        input.actorId,
        input.occurredAt,
      ],
    )
  }

  async createExpense(
    input: {
      id: string
      branchId: string
      category: string
      amount: string
      description: string
      actorId: string
      occurredAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO expenses
         (id, branch_id, category, amount, description, status, incurred_at,
          created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?)`,
      [
        input.id,
        input.branchId,
        input.category,
        input.amount,
        input.description,
        input.occurredAt,
        input.actorId,
        input.occurredAt,
        input.occurredAt,
      ],
    )
  }

  async listExpenses(
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, branch_id, category, amount, description, status,
              incurred_at, created_by, created_at
       FROM expenses WHERE branch_id = ? ORDER BY incurred_at DESC, id DESC`,
      [branchId],
    )
  }
}
