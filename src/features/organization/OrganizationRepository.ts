import type { SqlExecutor, SqlRow } from '../../infrastructure/database/types'

export class OrganizationRepository {
  private readonly database: SqlExecutor

  constructor(database: SqlExecutor) {
    this.database = database
  }

  async seedBusinessActivity(
    id: string,
    code: string,
    name: string,
    createdAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO business_activities
         (id, code, name, enabled, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)
       ON CONFLICT(code) DO NOTHING`,
      [id, code, name, createdAt, createdAt],
    )
  }

  async listBusinessActivities(
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, code, name, enabled, created_at, updated_at
       FROM business_activities ORDER BY code`,
    )
  }

  async getBusinessActivity(
    code: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, code, name, enabled, created_at, updated_at
       FROM business_activities WHERE code = ?`,
      [code],
    )
    return row ?? null
  }

  async setBusinessActivityEnabled(
    code: string,
    enabled: boolean,
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      'UPDATE business_activities SET enabled = ?, updated_at = ? WHERE code = ?',
      [enabled ? 1 : 0, updatedAt, code],
    )
  }

  async listBranches(
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, code, name, address, phone, status, created_at, updated_at
       FROM branches ORDER BY code`,
    )
  }

  async getBranch(
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, code, name, address, phone, status, created_at, updated_at
       FROM branches WHERE id = ?`,
      [branchId],
    )
    return row ?? null
  }

  async createBranch(
    input: {
      id: string
      code: string
      name: string
      address: string | null
      phone: string | null
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO branches
         (id, code, name, address, phone, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        input.id,
        input.code,
        input.name,
        input.address,
        input.phone,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async updateBranch(
    branchId: string,
    input: {
      code: string
      name: string
      address: string | null
      phone: string | null
    },
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `UPDATE branches
       SET code = ?, name = ?, address = ?, phone = ?, updated_at = ?
       WHERE id = ? AND status = 'active'`,
      [
        input.code,
        input.name,
        input.address,
        input.phone,
        updatedAt,
        branchId,
      ],
    )
  }

  async archiveBranch(
    branchId: string,
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      "UPDATE branches SET status = 'archived', updated_at = ? WHERE id = ?",
      [updatedAt, branchId],
    )
  }

  async listWarehouses(
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, branch_id, code, name, status, created_at, updated_at
       FROM warehouses ORDER BY branch_id, code`,
    )
  }

  async listWarehousesForBranch(
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, branch_id, code, name, status, created_at, updated_at
       FROM warehouses WHERE branch_id = ? ORDER BY code`,
      [branchId],
    )
  }

  async getWarehouse(
    warehouseId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, branch_id, code, name, status, created_at, updated_at
       FROM warehouses WHERE id = ?`,
      [warehouseId],
    )
    return row ?? null
  }

  async createWarehouse(
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
      `INSERT INTO warehouses
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

  async updateWarehouse(
    warehouseId: string,
    input: { branchId: string; code: string; name: string },
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `UPDATE warehouses
       SET branch_id = ?, code = ?, name = ?, updated_at = ?
       WHERE id = ? AND status = 'active'`,
      [input.branchId, input.code, input.name, updatedAt, warehouseId],
    )
  }

  async archiveWarehousesForBranch(
    branchId: string,
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      "UPDATE warehouses SET status = 'archived', updated_at = ? WHERE branch_id = ? AND status = 'active'",
      [updatedAt, branchId],
    )
  }

  async archiveWarehouse(
    warehouseId: string,
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      "UPDATE warehouses SET status = 'archived', updated_at = ? WHERE id = ? AND status = 'active'",
      [updatedAt, warehouseId],
    )
  }

  async isBranchActive(
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<boolean> {
    const [row] = await executor.query<{ is_active: number }>(
      "SELECT EXISTS (SELECT 1 FROM branches WHERE id = ? AND status = 'active') AS is_active",
      [branchId],
    )
    return row?.is_active === 1
  }

  async warehouseHasUsageOrAssignments(
    warehouseId: string,
    executor: SqlExecutor = this.database,
  ): Promise<boolean> {
    const [row] = await executor.query<{ has_usage: number }>(
      `SELECT (
         EXISTS (SELECT 1 FROM inventory_movements WHERE warehouse_id = ?) OR
         EXISTS (SELECT 1 FROM inventory_balances WHERE warehouse_id = ?) OR
         EXISTS (SELECT 1 FROM sales WHERE warehouse_id = ?) OR
         EXISTS (SELECT 1 FROM purchases WHERE warehouse_id = ?) OR
         EXISTS (
           SELECT 1 FROM stock_transfers
           WHERE from_warehouse_id = ? OR to_warehouse_id = ?
         ) OR
         EXISTS (SELECT 1 FROM stock_counts WHERE warehouse_id = ?) OR
         EXISTS (SELECT 1 FROM user_warehouse_access WHERE warehouse_id = ?)
       ) AS has_usage`,
      [
        warehouseId,
        warehouseId,
        warehouseId,
        warehouseId,
        warehouseId,
        warehouseId,
        warehouseId,
        warehouseId,
      ],
    )
    return row?.has_usage === 1
  }
}
