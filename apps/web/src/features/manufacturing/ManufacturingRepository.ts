import type { SqlExecutor, SqlRow } from '../../infrastructure/database/types'

export class ManufacturingRepository {
  private readonly database: SqlExecutor

  constructor(database: SqlExecutor) {
    this.database = database
  }

  async getWarehouse(
    warehouseId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT w.id, w.branch_id, w.warehouse_type,
              CASE WHEN w.status = 'active' AND w.is_active = FALSE THEN 'inactive'
                   ELSE w.status END AS warehouse_status,
              b.status AS branch_status
       FROM warehouses w JOIN branches b ON b.id = w.branch_id
       WHERE w.id = ?`,
      [warehouseId],
    )
    return row ?? null
  }

  async getProduct(
    productId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, sku, name, base_unit_id, status
       FROM products WHERE id = ?`,
      [productId],
    )
    return row ?? null
  }

  async getProductUnit(
    productId: string,
    unitId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT u.id, u.name AS unit_name, u.decimal_places,
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

  async countOrders(
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<number> {
    const [row] = await executor.query<{ order_count: number }>(
      'SELECT COUNT(*) AS order_count FROM manufacturing_orders WHERE branch_id = ?',
      [branchId],
    )
    return Number(row?.order_count ?? 0)
  }

  async createOrder(
    input: {
      id: string
      orderNumber: string
      branchId: string
      warehouseId: string
      finishedProductId: string
      plannedQuantity: string
      notes: string | null
      actorId: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO manufacturing_orders
         (id, order_number, branch_id, warehouse_id, finished_product_id,
          planned_quantity, status, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        input.id,
        input.orderNumber,
        input.branchId,
        input.warehouseId,
        input.finishedProductId,
        input.plannedQuantity,
        input.notes,
        input.actorId,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async addMaterial(
    input: {
      id: string
      orderId: string
      productId: string
      unitId: string
      quantity: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO manufacturing_materials
         (id, order_id, product_id, unit_id, planned_quantity,
          consumed_quantity, unit_cost, consumed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
      [
        input.id,
        input.orderId,
        input.productId,
        input.unitId,
        input.quantity,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async addStage(
    input: {
      id: string
      orderId: string
      name: string
      sequence: number
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO production_stages
         (id, order_id, name, sequence, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [input.id, input.orderId, input.name, input.sequence, input.createdAt],
    )
  }

  async getOrder(
    orderId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT mo.id, mo.order_number, mo.branch_id, mo.warehouse_id,
              mo.finished_product_id, p.sku AS finished_sku,
              p.name AS finished_product_name, mo.planned_quantity,
              mo.actual_quantity, mo.waste_quantity, mo.status, mo.notes,
              mo.created_by, mo.approved_by, mo.started_at, mo.completed_at,
              mo.created_at, mo.updated_at
       FROM manufacturing_orders mo
       JOIN products p ON p.id = mo.finished_product_id
       WHERE mo.id = ?`,
      [orderId],
    )
    return row ?? null
  }

  async listOrders(
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT mo.id, mo.order_number, mo.branch_id, mo.warehouse_id,
              mo.finished_product_id, p.sku AS finished_sku,
              p.name AS finished_product_name, mo.planned_quantity,
              mo.actual_quantity, mo.waste_quantity, mo.status, mo.notes,
              mo.created_by, mo.approved_by, mo.started_at, mo.completed_at,
              mo.created_at, mo.updated_at
       FROM manufacturing_orders mo
       JOIN products p ON p.id = mo.finished_product_id
       WHERE mo.branch_id = ?
       ORDER BY mo.created_at DESC, mo.id DESC`,
      [branchId],
    )
  }

  async getMaterials(
    orderId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT mm.id, mm.product_id, p.sku, p.name AS product_name,
              mm.unit_id, u.name AS unit_name, mm.planned_quantity,
              mm.consumed_quantity, mm.unit_cost, mm.consumed_at
       FROM manufacturing_materials mm
       JOIN products p ON p.id = mm.product_id
       JOIN measurement_units u ON u.id = mm.unit_id
       WHERE mm.order_id = ? ORDER BY mm.created_at, mm.id`,
      [orderId],
    )
  }

  async getMaterial(
    materialId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, order_id, product_id, unit_id, planned_quantity,
              consumed_quantity, unit_cost
       FROM manufacturing_materials WHERE id = ?`,
      [materialId],
    )
    return row ?? null
  }

  async updateMaterialConsumption(
    materialId: string,
    quantity: string,
    unitCost: string,
    consumedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `UPDATE manufacturing_materials
       SET consumed_quantity = ?, unit_cost = ?, consumed_at = ?, updated_at = ?
       WHERE id = ?`,
      [quantity, unitCost, consumedAt, consumedAt, materialId],
    )
  }

  async listStages(
    orderId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, name, sequence, status, started_at, completed_at, created_at
       FROM production_stages WHERE order_id = ? ORDER BY sequence, id`,
      [orderId],
    )
  }

  async getStage(
    stageId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, order_id, name, sequence, status, started_at, completed_at
       FROM production_stages WHERE id = ?`,
      [stageId],
    )
    return row ?? null
  }

  async updateStage(
    stageId: string,
    status: 'in_progress' | 'completed',
    startedAt: string | null,
    completedAt: string | null,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `UPDATE production_stages SET status = ?, started_at = ?, completed_at = ?
       WHERE id = ?`,
      [status, startedAt, completedAt, stageId],
    )
  }

  async updateOrderStatus(
    orderId: string,
    status: 'planned' | 'in_progress' | 'completed' | 'approved' | 'cancelled',
    updatedAt: string,
    startedAt: string | null,
    completedAt: string | null,
    approvedBy: string | null,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `UPDATE manufacturing_orders
       SET status = ?, updated_at = ?,
           started_at = COALESCE(started_at, ?),
           completed_at = COALESCE(?, completed_at),
           approved_by = COALESCE(?, approved_by)
       WHERE id = ?`,
      [status, updatedAt, startedAt, completedAt, approvedBy, orderId],
    )
  }

  async addCost(
    input: {
      id: string
      orderId: string
      costType: string
      amount: string
      description: string
      incurredAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO manufacturing_costs
         (id, order_id, cost_type, amount, description, incurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.orderId,
        input.costType,
        input.amount,
        input.description,
        input.incurredAt,
        input.incurredAt,
      ],
    )
  }

  async listCosts(
    orderId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, cost_type, amount, description, incurred_at
       FROM manufacturing_costs WHERE order_id = ?
       ORDER BY incurred_at, id`,
      [orderId],
    )
  }

  async createOutput(
    input: {
      id: string
      orderId: string
      productId: string
      unitId: string
      quantity: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO production_outputs
         (id, order_id, product_id, unit_id, quantity, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.orderId,
        input.productId,
        input.unitId,
        input.quantity,
        input.createdAt,
      ],
    )
  }

  async getOutput(
    orderId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, order_id, product_id, unit_id, quantity,
              approved_by, approved_at, created_at
       FROM production_outputs WHERE order_id = ?`,
      [orderId],
    )
    return row ?? null
  }

  async approveOutput(
    outputId: string,
    actorId: string,
    approvedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `UPDATE production_outputs SET approved_by = ?, approved_at = ?
       WHERE id = ? AND approved_at IS NULL`,
      [actorId, approvedAt, outputId],
    )
  }
}
