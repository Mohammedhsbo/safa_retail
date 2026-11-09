import type { SqlExecutor, SqlRow } from '../../infrastructure/database/types'

export class InventoryRepository {
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

  async getProduct(
    productId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, sku, name, base_unit_id, purchase_price, status
       FROM products WHERE id = ?`,
      [productId],
    )
    return row ?? null
  }

  async ensureProductBranchAvailabilityFromSource(
    productId: string,
    sourceBranchId: string,
    destinationBranchId: string,
    now: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO product_branch_availability
         (product_id, branch_id, purchase_price, selling_price, minimum_stock,
          status, created_at, updated_at)
       SELECT product_id, ?, purchase_price, selling_price, minimum_stock,
              'active', ?, ?
       FROM product_branch_availability
       WHERE product_id = ? AND branch_id = ?
       ON CONFLICT (product_id, branch_id) DO NOTHING`,
      [destinationBranchId, now, now, productId, sourceBranchId],
    )
  }

  async getProductUnit(
    productId: string,
    unitId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT u.id, u.decimal_places, u.status,
              CASE
                WHEN u.id = p.base_unit_id THEN '1'
                ELSE puc.factor_to_base
              END AS factor_to_base
       FROM products p
       JOIN measurement_units u ON u.id = ?
       LEFT JOIN product_unit_conversions puc
         ON puc.product_id = p.id AND puc.unit_id = u.id
       WHERE p.id = ?
         AND u.status = 'active'
         AND (u.id = p.base_unit_id OR puc.unit_id IS NOT NULL)`,
      [unitId, productId],
    )
    return row ?? null
  }

  async getBalance(
    productId: string,
    warehouseId: string,
    executor: SqlExecutor = this.database,
  ): Promise<{
    quantity: string
    averageUnitCost: string
    updatedAt: string | null
  }> {
    const [row] = await executor.query<{
      on_hand_quantity: string
      average_unit_cost: string
      updated_at: string
    }>(
      `SELECT on_hand_quantity, average_unit_cost, updated_at
       FROM inventory_balances
       WHERE product_id = ? AND warehouse_id = ?`,
      [productId, warehouseId],
    )
    return {
      quantity: row?.on_hand_quantity ?? '0',
      averageUnitCost: row?.average_unit_cost ?? '0',
      updatedAt: row?.updated_at ?? null,
    }
  }

  async setBalance(
    productId: string,
    warehouseId: string,
    quantity: string,
    averageUnitCost: string,
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO inventory_balances
         (product_id, warehouse_id, on_hand_quantity, reserved_quantity,
          average_unit_cost, updated_at)
       VALUES (?, ?, ?, '0', ?, ?)
       ON CONFLICT(product_id, warehouse_id) DO UPDATE SET
         on_hand_quantity = excluded.on_hand_quantity,
         average_unit_cost = excluded.average_unit_cost,
         updated_at = excluded.updated_at`,
      [productId, warehouseId, quantity, averageUnitCost, updatedAt],
    )
  }

  async addMovement(
    input: {
      id: string
      productId: string
      warehouseId: string
      movementType: string
      quantity: string
      unitId: string
      unitCost: string
      sourceType: string
      sourceId: string
      actorId: string
      occurredAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO inventory_movements
         (id, product_id, warehouse_id, movement_type, quantity, unit_id,
          unit_cost, source_type, source_id, occurred_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.productId,
        input.warehouseId,
        input.movementType,
        input.quantity,
        input.unitId,
        input.unitCost,
        input.sourceType,
        input.sourceId,
        input.occurredAt,
        input.actorId,
        input.occurredAt,
      ],
    )
  }

  async listBalances(
    warehouseId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT ib.product_id, p.sku, p.name, p.base_unit_id,
              ib.warehouse_id, ib.on_hand_quantity, ib.reserved_quantity,
              ib.average_unit_cost, ib.updated_at
       FROM inventory_balances ib
       JOIN products p ON p.id = ib.product_id
       JOIN warehouses w ON w.id = ib.warehouse_id
       WHERE ib.warehouse_id = ?
         AND EXISTS (
           SELECT 1 FROM product_branch_availability a
           WHERE a.product_id = ib.product_id AND a.branch_id = w.branch_id
         )
       ORDER BY p.name, p.sku`,
      [warehouseId],
    )
  }

  async listMovements(
    warehouseId: string,
    productId: string | null,
    limit: number,
    offset: number,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    const filter = productId === null ? '' : 'AND m.product_id = ?'
    const parameters =
      productId === null
        ? [warehouseId, limit, offset]
        : [warehouseId, productId, limit, offset]
    return executor.query(
      `SELECT m.id, m.product_id, p.sku, p.name, m.warehouse_id,
              m.movement_type, m.quantity, m.unit_id, m.unit_cost,
              m.source_type, m.source_id, m.occurred_at, m.created_by
       FROM inventory_movements m
       JOIN products p ON p.id = m.product_id
       JOIN warehouses w ON w.id = m.warehouse_id
       WHERE m.warehouse_id = ? ${filter}
         AND EXISTS (
           SELECT 1 FROM product_branch_availability a
           WHERE a.product_id = m.product_id AND a.branch_id = w.branch_id
         )
       ORDER BY m.occurred_at DESC, m.id DESC
       LIMIT ? OFFSET ?`,
      parameters,
    )
  }

  async listValuation(
    warehouseId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT ib.product_id, p.sku, p.name, p.base_unit_id,
              ib.on_hand_quantity, ib.average_unit_cost,
              ib.updated_at
       FROM inventory_balances ib
       JOIN products p ON p.id = ib.product_id
       JOIN warehouses w ON w.id = ib.warehouse_id
       JOIN product_branch_availability a
         ON a.product_id = ib.product_id AND a.branch_id = w.branch_id
       WHERE ib.warehouse_id = ?
       ORDER BY p.name, p.sku`,
      [warehouseId],
    )
  }

  async createTransfer(
    input: {
      id: string
      transferNumber: string
      fromBranchId: string
      fromWarehouseId: string
      toBranchId: string
      toWarehouseId: string
      notes: string | null
      requestedBy: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO stock_transfers
         (id, transfer_number, from_branch_id, from_warehouse_id,
          to_branch_id, to_warehouse_id, status, notes, requested_by,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        input.id,
        input.transferNumber,
        input.fromBranchId,
        input.fromWarehouseId,
        input.toBranchId,
        input.toWarehouseId,
        input.notes,
        input.requestedBy,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async addTransferItem(
    input: {
      id: string
      transferId: string
      productId: string
      unitId: string
      quantity: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO stock_transfer_items
         (id, transfer_id, product_id, unit_id, quantity, received_quantity, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      [
        input.id,
        input.transferId,
        input.productId,
        input.unitId,
        input.quantity,
        input.createdAt,
      ],
    )
  }

  async getTransfer(
    transferId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, transfer_number, from_branch_id, from_warehouse_id,
              to_branch_id, to_warehouse_id, status, notes, requested_by,
              approved_by, received_by, created_at, updated_at
       FROM stock_transfers WHERE id = ?`,
      [transferId],
    )
    return row ?? null
  }

  async listTransfersForWarehouse(
    warehouseId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, transfer_number, from_branch_id, from_warehouse_id,
              to_branch_id, to_warehouse_id, status, notes, requested_by,
              approved_by, received_by, created_at, updated_at
       FROM stock_transfers
       WHERE from_warehouse_id = ? OR to_warehouse_id = ?
       ORDER BY created_at DESC, id DESC`,
      [warehouseId, warehouseId],
    )
  }

  async getTransferItems(
    transferId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, product_id, unit_id, quantity, received_quantity, created_at
       FROM stock_transfer_items WHERE transfer_id = ? ORDER BY product_id`,
      [transferId],
    )
  }

  async getTransferMovementCost(
    transferId: string,
    warehouseId: string,
    productId: string,
    executor: SqlExecutor = this.database,
  ): Promise<string | null> {
    const [row] = await executor.query<{ unit_cost: string }>(
      `SELECT unit_cost FROM inventory_movements
       WHERE source_type = 'stock_transfer'
         AND source_id = ?
         AND warehouse_id = ?
         AND product_id = ?
         AND movement_type = 'transfer_out'
       ORDER BY created_at, id LIMIT 1`,
      [transferId, warehouseId, productId],
    )
    return row?.unit_cost ?? null
  }

  async getSaleMovementCost(
    saleId: string,
    warehouseId: string,
    productId: string,
    executor: SqlExecutor = this.database,
  ): Promise<string | null> {
    const [row] = await executor.query<{ unit_cost: string }>(
      `SELECT unit_cost FROM inventory_movements
       WHERE source_type = 'sale' AND source_id = ?
         AND warehouse_id = ? AND product_id = ?
         AND movement_type = 'sale_out'
       ORDER BY created_at, id LIMIT 1`,
      [saleId, warehouseId, productId],
    )
    return row?.unit_cost ?? null
  }

  async setTransferItemReceived(
    itemId: string,
    receivedQuantity: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      'UPDATE stock_transfer_items SET received_quantity = ? WHERE id = ?',
      [receivedQuantity, itemId],
    )
  }

  async setTransferStatus(
    transferId: string,
    status: string,
    updatedAt: string,
    executor: SqlExecutor = this.database,
    actorId?: string,
  ): Promise<void> {
    if (status === 'approved' && actorId) {
      await executor.run(
        'UPDATE stock_transfers SET status = ?, approved_by = ?, updated_at = ? WHERE id = ?',
        [status, actorId, updatedAt, transferId],
      )
      return
    }
    if (status === 'received' && actorId) {
      await executor.run(
        'UPDATE stock_transfers SET status = ?, received_by = ?, updated_at = ? WHERE id = ?',
        [status, actorId, updatedAt, transferId],
      )
      return
    }
    await executor.run(
      'UPDATE stock_transfers SET status = ?, updated_at = ? WHERE id = ?',
      [status, updatedAt, transferId],
    )
  }

  async getCount(
    countId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, count_number, warehouse_id, status, counted_by, approved_by,
              started_at, completed_at, created_at, updated_at
       FROM stock_counts WHERE id = ?`,
      [countId],
    )
    return row ?? null
  }

  async listCountsForWarehouse(
    warehouseId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, count_number, warehouse_id, status, counted_by, approved_by,
              started_at, completed_at, created_at, updated_at
       FROM stock_counts WHERE warehouse_id = ?
       ORDER BY created_at DESC, id DESC`,
      [warehouseId],
    )
  }

  async createCount(
    input: {
      id: string
      countNumber: string
      warehouseId: string
      countedBy: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO stock_counts
         (id, count_number, warehouse_id, status, counted_by, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
      [
        input.id,
        input.countNumber,
        input.warehouseId,
        input.countedBy,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async addCountItem(
    input: {
      id: string
      countId: string
      productId: string
      expectedQuantity: string
      unitId: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO stock_count_items
         (id, stock_count_id, product_id, expected_quantity, counted_quantity, unit_id, notes)
       VALUES (?, ?, ?, ?, NULL, ?, NULL)`,
      [
        input.id,
        input.countId,
        input.productId,
        input.expectedQuantity,
        input.unitId,
      ],
    )
  }

  async getCountItems(
    countId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, product_id, expected_quantity, counted_quantity, unit_id, notes
       FROM stock_count_items WHERE stock_count_id = ? ORDER BY product_id`,
      [countId],
    )
  }

  async setCountStatus(
    countId: string,
    status: string,
    updatedAt: string,
    executor: SqlExecutor = this.database,
    actorId?: string,
  ): Promise<void> {
    if (status === 'counting') {
      await executor.run(
        `UPDATE stock_counts SET status = ?, started_at = ?, updated_at = ?
         WHERE id = ?`,
        [status, updatedAt, updatedAt, countId],
      )
      return
    }
    if (status === 'approved' && actorId) {
      await executor.run(
        `UPDATE stock_counts
         SET status = ?, approved_by = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`,
        [status, actorId, updatedAt, updatedAt, countId],
      )
      return
    }
    await executor.run(
      'UPDATE stock_counts SET status = ?, updated_at = ? WHERE id = ?',
      [status, updatedAt, countId],
    )
  }

  async recordCountItem(
    itemId: string,
    countedQuantity: string,
    notes: string | null,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `UPDATE stock_count_items SET counted_quantity = ?, notes = ?
       WHERE id = ?`,
      [countedQuantity, notes, itemId],
    )
  }

  async getCountItem(
    countId: string,
    productId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, product_id, expected_quantity, counted_quantity, unit_id, notes
       FROM stock_count_items
       WHERE stock_count_id = ? AND product_id = ?`,
      [countId, productId],
    )
    return row ?? null
  }
}
