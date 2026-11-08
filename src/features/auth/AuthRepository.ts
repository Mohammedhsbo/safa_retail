import { z } from 'zod'
import { DatabaseError } from '../../infrastructure/database/errors'
import type { SqlDatabase, SqlExecutor, SqlRow } from '../../infrastructure/database/types'
import {
  permissionCodes,
  type AuthenticatedUser,
  type PermissionCode,
  type SystemRoleCode,
} from './auth.types'
import { createUuid } from '../../infrastructure/database/uuid'

interface StoredUser extends SqlRow {
  id: string
  username: string
  password_hash: string
  display_name: string
  status: 'active' | 'disabled' | 'archived'
}

const storedUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(3).max(64),
  password_hash: z.string().min(1),
  display_name: z.string().min(1),
  status: z.enum(['active', 'disabled', 'archived']),
})

const accessUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  display_name: z.string(),
  status: z.enum(['active', 'disabled', 'archived']),
})

const systemRoles: ReadonlyArray<{ code: SystemRoleCode; name: string }> = [
  { code: 'system_owner', name: 'System Owner' },
  { code: 'general_manager', name: 'General Manager' },
  { code: 'branch_manager', name: 'Branch Manager' },
  { code: 'warehouse_manager', name: 'Warehouse Manager' },
  { code: 'sales_employee', name: 'Sales Employee' },
  { code: 'purchasing_employee', name: 'Purchasing Employee' },
  { code: 'accountant', name: 'Accountant' },
  { code: 'manufacturing_employee', name: 'Manufacturing Employee' },
]

const permissionDescriptions: Record<PermissionCode, string> = {
  'products.read': 'View products',
  'products.create': 'Create products',
  'products.update': 'Update products',
  'products.delete': 'Archive products',
  'sales.read': 'View sales',
  'sales.create': 'Create sales',
  'sales.cancel': 'Cancel sales',
  'sales.discount': 'Apply sales discounts',
  'sales.returns': 'Process sales returns and refunds',
  'purchases.read': 'View purchases',
  'purchases.create': 'Create purchases',
  'purchases.returns': 'Return purchases',
  'inventory.read': 'View inventory',
  'inventory.adjust': 'Adjust inventory',
  'inventory.transfer': 'Transfer inventory',
  'inventory.count': 'Count inventory',
  'customers.manage': 'Manage customers',
  'suppliers.manage': 'Manage suppliers',
  'accounting.read': 'View accounting records',
  'accounting.manage': 'Manage accounting records',
  'reports.read': 'View reports',
  'users.manage': 'Manage users',
  'roles.manage': 'Manage roles and permission grants',
  'settings.manage': 'Manage application settings',
  'manufacturing.manage': 'Manage manufacturing',
}

export class AuthRepository {
  private readonly database: SqlExecutor
  private readonly sqliteDatabase: SqlDatabase

  constructor(database: SqlDatabase) {
    this.database = database
    this.sqliteDatabase = database
  }

  async seedAuthorizationCatalog(
    createdAt = new Date().toISOString(),
  ): Promise<void> {
    await this.sqliteDatabase.withTransaction(async (transaction) => {
      for (const role of systemRoles) {
        await transaction.run(
          `INSERT INTO roles (id, code, name, is_system, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)
           ON CONFLICT(code) DO NOTHING`,
          [createUuid(), role.code, role.name, createdAt, createdAt],
        )
      }

      for (const code of permissionCodes) {
        await transaction.run(
          'INSERT INTO permissions (code, description) VALUES (?, ?) ON CONFLICT(code) DO NOTHING',
          [code, permissionDescriptions[code]],
        )
      }

      const ownerRole = await transaction.query<{ id: string }>(
        "SELECT id FROM roles WHERE code = 'system_owner'",
      )
      const ownerRoleId = ownerRole[0]?.id
      if (!ownerRoleId) {
        throw new DatabaseError('The system owner role could not be initialized')
      }

      for (const code of permissionCodes) {
        await transaction.run(
          'INSERT INTO role_permissions (role_id, permission_code) VALUES (?, ?) ON CONFLICT(role_id, permission_code) DO NOTHING',
          [ownerRoleId, code],
        )
      }
    })
  }

  async countUsers(executor: SqlExecutor = this.database): Promise<number> {
    const [row] = await executor.query<{ user_count: number }>(
      'SELECT COUNT(*) AS user_count FROM users',
    )

    if (!row || !Number.isSafeInteger(row.user_count)) {
      throw new DatabaseError('Could not read the local user count')
    }

    return row.user_count
  }

  async findUserByUsername(
    username: string,
    executor: SqlExecutor = this.database,
  ): Promise<StoredUser | null> {
    const [row] = await executor.query(
      `SELECT id, username, password_hash, display_name, status
       FROM users WHERE LOWER(username) = LOWER(?)`,
      [username],
    )

    if (!row) {
      return null
    }

    const parsed = storedUserSchema.safeParse(row)
    if (!parsed.success) {
      throw new DatabaseError('The local user record is invalid', {
        cause: parsed.error,
      })
    }

    return parsed.data
  }

  async findUserById(
    userId: string,
    executor: SqlExecutor = this.database,
  ): Promise<StoredUser | null> {
    const [row] = await executor.query(
      `SELECT id, username, password_hash, display_name, status
       FROM users WHERE id = ?`,
      [userId],
    )

    if (!row) {
      return null
    }

    const parsed = storedUserSchema.safeParse(row)
    if (!parsed.success) {
      throw new DatabaseError('The local user record is invalid', {
        cause: parsed.error,
      })
    }

    return parsed.data
  }

  async createUser(
    input: {
      id: string
      username: string
      passwordHash: string
      displayName: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO users
         (id, username, password_hash, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      [
        input.id,
        input.username,
        input.passwordHash,
        input.displayName,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async updatePassword(
    userId: string,
    passwordHash: string,
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    const changed = await executor.run(
      'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
      [passwordHash, updatedAt, userId],
    )

    if (changed !== 1) {
      throw new DatabaseError('The local user no longer exists')
    }
  }

  async updateUserAccount(
    userId: string,
    username: string,
    displayName: string,
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    const changed = await executor.run(
      'UPDATE users SET username = ?, display_name = ?, updated_at = ? WHERE id = ?',
      [username, displayName, updatedAt, userId],
    )

    if (changed !== 1) {
      throw new DatabaseError('The local user no longer exists')
    }
  }

  async setUserStatus(
    userId: string,
    status: 'active' | 'disabled' | 'archived',
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    const changed = await executor.run(
      'UPDATE users SET status = ?, updated_at = ? WHERE id = ?',
      [status, updatedAt, userId],
    )

    if (changed !== 1) {
      throw new DatabaseError('The local user no longer exists')
    }
  }

  async assignRoles(
    userId: string,
    roleIds: readonly string[],
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run('DELETE FROM user_roles WHERE user_id = ?', [userId])

    for (const roleId of roleIds) {
      await executor.run(
        'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
        [userId, roleId],
      )
    }
  }

  async assignBranchAccess(
    userId: string,
    branchIds: readonly string[],
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run('DELETE FROM user_branch_access WHERE user_id = ?', [
      userId,
    ])

    for (const branchId of branchIds) {
      await executor.run(
        'INSERT INTO user_branch_access (user_id, branch_id) VALUES (?, ?)',
        [userId, branchId],
      )
    }
  }

  async assignWarehouseAccess(
    userId: string,
    warehouseIds: readonly string[],
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run('DELETE FROM user_warehouse_access WHERE user_id = ?', [
      userId,
    ])

    for (const warehouseId of warehouseIds) {
      await executor.run(
        'INSERT INTO user_warehouse_access (user_id, warehouse_id) VALUES (?, ?)',
        [userId, warehouseId],
      )
    }
  }

  async getRoleByCode(
    code: string,
    executor: SqlExecutor = this.database,
  ): Promise<{ id: string; code: string } | null> {
    const [row] = await executor.query<{ id: string; code: string }>(
      'SELECT id, code FROM roles WHERE code = ?',
      [code],
    )

    return row ?? null
  }

  async getRoles(
    executor: SqlExecutor = this.database,
  ): Promise<Array<{ id: string; code: string; name: string; isSystem: boolean }>> {
    const rows = await executor.query<{
      id: string
      code: string
      name: string
      is_system: number
    }>('SELECT id, code, name, is_system FROM roles ORDER BY name')

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      isSystem: row.is_system === 1,
    }))
  }

  async getPermissions(
    executor: SqlExecutor = this.database,
  ): Promise<PermissionCode[]> {
    const rows = await executor.query<{ code: string }>(
      'SELECT code FROM permissions ORDER BY code',
    )

    return rows.map((row) => {
      if (!permissionCodes.includes(row.code as PermissionCode)) {
        throw new DatabaseError(
          `The permission catalog contains an unknown code: ${row.code}`,
        )
      }

      return row.code as PermissionCode
    })
  }

  async setRolePermissions(
    roleId: string,
    codes: readonly PermissionCode[],
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run('DELETE FROM role_permissions WHERE role_id = ?', [
      roleId,
    ])

    for (const code of codes) {
      await executor.run(
        'INSERT INTO role_permissions (role_id, permission_code) VALUES (?, ?)',
        [roleId, code],
      )
    }
  }

  async getUser(
    userId: string,
    executor: SqlExecutor = this.database,
  ): Promise<{ id: string; username: string; displayName: string; status: string } | null> {
    const [row] = await executor.query(
      'SELECT id, username, display_name, status FROM users WHERE id = ?',
      [userId],
    )
    if (!row) {
      return null
    }

    const parsed = accessUserSchema.safeParse({
      ...row,
      displayName: row.display_name,
    })
    if (!parsed.success) {
      throw new DatabaseError('The local user record is invalid', {
        cause: parsed.error,
      })
    }

    return {
      id: parsed.data.id,
      username: parsed.data.username,
      displayName: parsed.data.display_name,
      status: parsed.data.status,
    }
  }

  async getUserRoleCodes(
    userId: string,
    executor: SqlExecutor = this.database,
  ): Promise<string[]> {
    const rows = await executor.query<{ code: string }>(
      `SELECT r.code FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ? ORDER BY r.code`,
      [userId],
    )

    return rows.map((row) => row.code)
  }

  async getRolePermissionGrantMap(
    roleIds: readonly string[],
    executor: SqlExecutor = this.database,
  ): Promise<Map<string, PermissionCode[]>> {
    const grantMap = new Map<string, PermissionCode[]>()

    for (const roleId of roleIds) {
      grantMap.set(roleId, await this.getRolePermissionCodes(roleId, executor))
    }

    return grantMap
  }

  async listUsers(
    executor: SqlExecutor = this.database,
  ): Promise<Array<{ id: string; username: string; displayName: string; status: string }>> {
    const rows = await executor.query(
      'SELECT id, username, display_name, status FROM users ORDER BY username',
    )

    return rows.map((row) => {
      const parsed = accessUserSchema.safeParse({
        ...row,
        displayName: row.display_name,
      })
      if (!parsed.success) {
        throw new DatabaseError('A local user record is invalid', {
          cause: parsed.error,
        })
      }

      return {
        id: parsed.data.id,
        username: parsed.data.username,
        displayName: parsed.data.display_name,
        status: parsed.data.status,
      }
    })
  }

  async getPrincipal(
    userId: string,
    executor: SqlExecutor = this.database,
  ): Promise<AuthenticatedUser | null> {
    const user = await this.getUser(userId, executor)
    if (!user || user.status !== 'active') {
      return null
    }

    const [roleRows, permissionRows, branchRows, warehouseRows] =
      await Promise.all([
        executor.query<{ code: string }>(
          `SELECT r.code FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = ? ORDER BY r.code`,
          [userId],
        ),
        executor.query<{ code: string }>(
          `SELECT DISTINCT rp.permission_code AS code
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           JOIN role_permissions rp ON rp.role_id = r.id
           WHERE ur.user_id = ? ORDER BY rp.permission_code`,
          [userId],
        ),
        executor.query<{ branch_id: string }>(
          'SELECT branch_id FROM user_branch_access WHERE user_id = ? ORDER BY branch_id',
          [userId],
        ),
        executor.query<{ warehouse_id: string }>(
          'SELECT warehouse_id FROM user_warehouse_access WHERE user_id = ? ORDER BY warehouse_id',
          [userId],
        ),
      ])

    const roleCodes = roleRows.map((row) => row.code)
    const permissions = permissionRows.map((row) => row.code)

    if (roleCodes.includes('system_owner')) {
      const allPermissions = await this.getPermissions(executor)
      return {
        ...user,
        roleCodes,
        permissions: allPermissions,
        branchIds: branchRows.map((row) => row.branch_id),
        warehouseIds: warehouseRows.map((row) => row.warehouse_id),
      }
    }

    return {
      ...user,
      roleCodes,
      permissions,
      branchIds: branchRows.map((row) => row.branch_id),
      warehouseIds: warehouseRows.map((row) => row.warehouse_id),
    }
  }

  async getRolePermissionCodes(
    roleId: string,
    executor: SqlExecutor = this.database,
  ): Promise<PermissionCode[]> {
    const rows = await executor.query<{ permission_code: string }>(
      'SELECT permission_code FROM role_permissions WHERE role_id = ? ORDER BY permission_code',
      [roleId],
    )

    return rows.map((row) => {
      if (!permissionCodes.includes(row.permission_code as PermissionCode)) {
        throw new DatabaseError(
          `The role contains an unknown permission: ${row.permission_code}`,
        )
      }
      return row.permission_code as PermissionCode
    })
  }

  async getWarehouseBranch(
    warehouseId: string,
    executor: SqlExecutor = this.database,
  ): Promise<string | null> {
    const [row] = await executor.query<{ branch_id: string }>(
      `SELECT w.branch_id FROM warehouses w
       JOIN branches b ON b.id = w.branch_id
       WHERE w.id = ? AND w.status = 'active' AND b.status = 'active'`,
      [warehouseId],
    )

    return row?.branch_id ?? null
  }

  async hasBranchAccess(
    userId: string,
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<boolean> {
    const rows = await executor.query(
      `SELECT 1 AS allowed FROM user_branch_access uba
       JOIN branches b ON b.id = uba.branch_id
       WHERE uba.user_id = ? AND uba.branch_id = ? AND b.status = 'active'`,
      [userId, branchId],
    )

    return rows.length === 1
  }

  async hasActiveBranch(
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<boolean> {
    const rows = await executor.query(
      "SELECT 1 AS active FROM branches WHERE id = ? AND status = 'active'",
      [branchId],
    )
    return rows.length === 1
  }

  async hasWarehouseAccess(
    userId: string,
    warehouseId: string,
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<boolean> {
    const rows = await executor.query(
      `SELECT 1 AS allowed
       FROM user_warehouse_access uwa
       JOIN warehouses w ON w.id = uwa.warehouse_id
       JOIN user_branch_access uba
         ON uba.user_id = uwa.user_id AND uba.branch_id = w.branch_id
       JOIN branches b ON b.id = w.branch_id
       WHERE uwa.user_id = ? AND uwa.warehouse_id = ? AND w.branch_id = ?
         AND w.status = 'active' AND b.status = 'active'`,
      [userId, warehouseId, branchId],
    )

    return rows.length === 1
  }

  async isLastActiveOwner(
    userId: string,
    executor: SqlExecutor = this.database,
  ): Promise<boolean> {
    const [row] = await executor.query<{ owner_count: number }>(
      `SELECT COUNT(DISTINCT u.id) AS owner_count
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.code = 'system_owner' AND u.status = 'active' AND u.id <> ?`,
      [userId],
    )

    if (!row || !Number.isSafeInteger(row.owner_count)) {
      throw new DatabaseError('Could not verify the active owner count')
    }

    return row.owner_count === 0
  }

  async getSystemOwnerRoleId(
    executor: SqlExecutor = this.database,
  ): Promise<string> {
    const role = await this.getRoleByCode('system_owner', executor)
    if (!role) {
      throw new DatabaseError('The system owner role has not been initialized')
    }

    return role.id
  }

  async writeAudit(
    input: {
      actorUserId: string
      action: string
      entityType: string
      entityId: string
      beforeData?: string | null
      afterData?: string | null
      occurredAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO audit_logs
         (id, actor_user_id, action, entity_type, entity_id, before_data, after_data, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createUuid(),
        input.actorUserId,
        input.action,
        input.entityType,
        input.entityId,
        input.beforeData ?? null,
        input.afterData ?? null,
        input.occurredAt,
        input.occurredAt,
      ],
    )
  }
}
