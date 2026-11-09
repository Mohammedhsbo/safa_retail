import { z } from 'zod'
import { createUuid } from '../../infrastructure/database/uuid'
import type { SqlDatabase } from '../../infrastructure/database/types'
import { AccessControlService } from './AccessControlService'
import { AuthRepository } from './AuthRepository'
import { AuthorizationError } from './auth.errors'
import { userInputSchema, type PasswordHasher } from './auth.types'

const userStatusSchema = z.enum(['active', 'disabled', 'archived'])
const userAccountSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
  displayName: z.string().trim().min(1).max(120),
})

export class UserManagementService {
  private readonly database: SqlDatabase
  private readonly repository: AuthRepository
  private readonly access: AccessControlService
  private readonly passwordHasher: PasswordHasher

  constructor(database: SqlDatabase, passwordHasher: PasswordHasher) {
    this.database = database
    this.repository = new AuthRepository(database)
    this.access = new AccessControlService(database)
    this.passwordHasher = passwordHasher
  }

  async listUsers(actorId: string) {
    await this.access.assertPermission(actorId, 'users.manage')
    return this.repository.listUsers()
  }

  async createUser(actorId: string, input: unknown): Promise<string> {
    const parsed = userInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AuthorizationError('User details are invalid')
    }

    await this.assertNoDuplicateIds(parsed.data)
    const passwordHash = await this.passwordHasher.hash(parsed.data.password)
    const userId = createUuid()
    const now = new Date().toISOString()

    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'users.manage',
        transaction,
      )
      await this.assertMayAssignRoles(
        actorId,
        parsed.data.roleCodes,
        transaction,
      )
      await this.assertActiveBranchAssignments(
        parsed.data.branchIds,
        transaction,
      )
      await this.assertWarehouseAssignments(
        parsed.data.branchIds,
        parsed.data.warehouseIds,
        transaction,
      )

      const roleIds = await this.resolveRoleIds(
        parsed.data.roleCodes,
        transaction,
      )
      await this.repository.createUser(
        {
          id: userId,
          username: parsed.data.username,
          passwordHash,
          displayName: parsed.data.displayName,
          createdAt: now,
        },
        transaction,
      )
      await this.repository.assignRoles(userId, roleIds, transaction)
      await this.repository.assignBranchAccess(
        userId,
        parsed.data.branchIds,
        transaction,
      )
      await this.repository.assignWarehouseAccess(
        userId,
        parsed.data.warehouseIds,
        transaction,
      )
      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'user.created',
          entityType: 'user',
          entityId: userId,
          afterData: JSON.stringify({
            username: parsed.data.username,
            roleCodes: parsed.data.roleCodes,
            branchIds: parsed.data.branchIds,
            warehouseIds: parsed.data.warehouseIds,
          }),
          occurredAt: now,
        },
        transaction,
      )
    })

    return userId
  }

  async assignRoles(
    actorId: string,
    userId: string,
    roleCodes: readonly string[],
  ): Promise<void> {
    const parsedRoleCodes = z.array(z.string().min(1)).min(1).safeParse(roleCodes)
    if (!parsedRoleCodes.success) {
      throw new AuthorizationError('At least one valid role is required')
    }

    await this.assertNoDuplicateValues(parsedRoleCodes.data)
    const now = new Date().toISOString()

    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'users.manage',
        transaction,
      )
      const target = await this.repository.getUser(userId, transaction)
      if (!target) {
        throw new AuthorizationError('The selected user does not exist')
      }

      const targetRoles = await this.repository.getUserRoleCodes(
        userId,
        transaction,
      )
      if (targetRoles.includes('system_owner')) {
        throw new AuthorizationError(
          'System owner roles cannot be changed through user management',
        )
      }

      await this.assertMayAssignRoles(
        actorId,
        parsedRoleCodes.data,
        transaction,
      )
      const roleIds = await this.resolveRoleIds(
        parsedRoleCodes.data,
        transaction,
      )
      await this.repository.assignRoles(userId, roleIds, transaction)
      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'user.roles_updated',
          entityType: 'user',
          entityId: userId,
          beforeData: JSON.stringify({ roleCodes: targetRoles }),
          afterData: JSON.stringify({ roleCodes: parsedRoleCodes.data }),
          occurredAt: now,
        },
        transaction,
      )
    })
  }

  async setUserAccess(
    actorId: string,
    userId: string,
    branchIds: readonly string[],
    warehouseIds: readonly string[],
  ): Promise<void> {
    const parsedIds = z.object({
      branchIds: z.array(z.string().uuid()),
      warehouseIds: z.array(z.string().uuid()),
    }).safeParse({ branchIds, warehouseIds })
    if (!parsedIds.success) {
      throw new AuthorizationError('Branch or warehouse access is invalid')
    }

    await this.assertNoDuplicateIds(parsedIds.data)
    const now = new Date().toISOString()

    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'users.manage',
        transaction,
      )
      const target = await this.repository.getUser(userId, transaction)
      if (!target) {
        throw new AuthorizationError('The selected user does not exist')
      }
      if (
        (await this.repository.getUserRoleCodes(userId, transaction)).includes(
          'system_owner',
        )
      ) {
        throw new AuthorizationError(
          'System owner access cannot be restricted through user management',
        )
      }

      await this.assertWarehouseAssignments(
        parsedIds.data.branchIds,
        parsedIds.data.warehouseIds,
        transaction,
      )
      await this.assertActiveBranchAssignments(
        parsedIds.data.branchIds,
        transaction,
      )

      const before = {
        branchIds: await this.getBranchIds(userId, transaction),
        warehouseIds: await this.getWarehouseIds(userId, transaction),
      }

      await this.repository.assignBranchAccess(
        userId,
        parsedIds.data.branchIds,
        transaction,
      )
      await this.repository.assignWarehouseAccess(
        userId,
        parsedIds.data.warehouseIds,
        transaction,
      )
      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'user.access_updated',
          entityType: 'user',
          entityId: userId,
          beforeData: JSON.stringify(before),
          afterData: JSON.stringify(parsedIds.data),
          occurredAt: now,
        },
        transaction,
      )
    })
  }

  async setUserStatus(
    actorId: string,
    userId: string,
    status: string,
  ): Promise<void> {
    const parsedStatus = userStatusSchema.safeParse(status)
    if (!parsedStatus.success) {
      throw new AuthorizationError('The user status is invalid')
    }

    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'users.manage',
        transaction,
      )
      const target = await this.repository.getUser(userId, transaction)
      if (!target) {
        throw new AuthorizationError('The selected user does not exist')
      }

      const targetRoles = await this.repository.getUserRoleCodes(
        userId,
        transaction,
      )
      if (
        targetRoles.includes('system_owner') &&
        parsedStatus.data !== 'active'
      ) {
        if (await this.repository.isLastActiveOwner(userId, transaction)) {
          throw new AuthorizationError(
            'The last active system owner cannot be disabled or archived',
          )
        }

        throw new AuthorizationError(
          'System owner status cannot be changed through user management',
        )
      }

      await this.repository.setUserStatus(
        userId,
        parsedStatus.data,
        now,
        transaction,
      )
      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'user.status_updated',
          entityType: 'user',
          entityId: userId,
          beforeData: JSON.stringify({ status: target.status }),
          afterData: JSON.stringify({ status: parsedStatus.data }),
          occurredAt: now,
        },
        transaction,
      )
    })
  }

  async resetPassword(
    actorId: string,
    userId: string,
    newPassword: string,
  ): Promise<void> {
    const parsedPassword = z.string().min(12).max(128).safeParse(newPassword)
    if (!parsedPassword.success) {
      throw new AuthorizationError('The new password does not meet requirements')
    }

    const passwordHash = await this.passwordHasher.hash(parsedPassword.data)
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'users.manage',
        transaction,
      )
      const target = await this.repository.getUser(userId, transaction)
      if (!target) {
        throw new AuthorizationError('The selected user does not exist')
      }

      await this.repository.updatePassword(
        userId,
        passwordHash,
        now,
        transaction,
      )
      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'user.password_reset',
          entityType: 'user',
          entityId: userId,
          occurredAt: now,
        },
        transaction,
      )
    })
  }

  async updateUserAccount(
    actorId: string,
    userId: string,
    input: unknown,
  ): Promise<void> {
    const parsedAccount = userAccountSchema.safeParse(input)
    if (!parsedAccount.success) {
      throw new AuthorizationError('User account details are invalid')
    }

    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'users.manage', transaction)
      const target = await this.repository.getUser(userId, transaction)
      if (!target) {
        throw new AuthorizationError('The selected user does not exist')
      }

      await this.repository.updateUserAccount(
        userId,
        parsedAccount.data.username,
        parsedAccount.data.displayName,
        now,
        transaction,
      )
      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'user.account_updated',
          entityType: 'user',
          entityId: userId,
          beforeData: JSON.stringify({
            username: target.username,
            displayName: target.displayName,
          }),
          afterData: JSON.stringify(parsedAccount.data),
          occurredAt: now,
        },
        transaction,
      )
    })
  }

  private async assertMayAssignRoles(
    actorId: string,
    roleCodes: readonly string[],
    transaction: Parameters<
      Parameters<SqlDatabase['withTransaction']>[0]
    >[0],
  ): Promise<void> {
    const actor = await this.repository.getPrincipal(actorId, transaction)
    if (!actor) {
      throw new AuthorizationError('The acting user is not active')
    }

    if (actor.roleCodes.includes('system_owner')) {
      if (roleCodes.includes('system_owner')) {
        throw new AuthorizationError(
          'The system owner role can only be assigned during secure initial setup',
        )
      }
      return
    }

    const grantablePermissions = new Set(actor.permissions)
    const roles = await this.repository.getRoles(transaction)

    for (const code of roleCodes) {
      if (code === 'system_owner') {
        throw new AuthorizationError('The system owner role cannot be assigned')
      }

      const role = roles.find((item) => item.code === code)
      if (!role) {
        throw new AuthorizationError(`Unknown role: ${code}`)
      }

      const rolePermissions = await this.repository.getRolePermissionCodes(
        role.id,
        transaction,
      )
      if (rolePermissions.some((permission) => !grantablePermissions.has(permission))) {
        throw new AuthorizationError(
          `The acting user cannot grant all permissions in role ${code}`,
        )
      }
    }
  }

  private async resolveRoleIds(
    roleCodes: readonly string[],
    transaction: Parameters<
      Parameters<SqlDatabase['withTransaction']>[0]
    >[0],
  ): Promise<string[]> {
    const roles = await this.repository.getRoles(transaction)
    return roleCodes.map((code) => {
      const role = roles.find((item) => item.code === code)
      if (!role || code === 'system_owner') {
        throw new AuthorizationError(`Unknown or restricted role: ${code}`)
      }
      return role.id
    })
  }

  private async assertWarehouseAssignments(
    branchIds: readonly string[],
    warehouseIds: readonly string[],
    transaction: Parameters<
      Parameters<SqlDatabase['withTransaction']>[0]
    >[0],
  ): Promise<void> {
    const allowedBranches = new Set(branchIds)

    for (const warehouseId of warehouseIds) {
      const [warehouse] = await transaction.query<{
        branch_id: string
        warehouse_status: string
        branch_status: string
      }>(
        `SELECT w.branch_id,
                CASE WHEN w.status = 'active' AND w.is_active = FALSE THEN 'inactive'
                     ELSE w.status END AS warehouse_status,
                b.status AS branch_status
         FROM warehouses w
         JOIN branches b ON b.id = w.branch_id
         WHERE w.id = ?`,
        [warehouseId],
      )
      if (
        !warehouse ||
        warehouse.warehouse_status !== 'active' ||
        warehouse.branch_status !== 'active' ||
        !allowedBranches.has(warehouse.branch_id)
      ) {
        throw new AuthorizationError(
          'Every assigned warehouse must belong to an active assigned branch',
        )
      }
    }
  }

  private async assertActiveBranchAssignments(
    branchIds: readonly string[],
    transaction: Parameters<
      Parameters<SqlDatabase['withTransaction']>[0]
    >[0],
  ): Promise<void> {
    for (const branchId of branchIds) {
      const [branch] = await transaction.query<{ status: string }>(
        'SELECT status FROM branches WHERE id = ?',
        [branchId],
      )
      if (!branch || branch.status !== 'active') {
        throw new AuthorizationError(
          'Users can only be assigned to active branches',
        )
      }
    }
  }

  private async getBranchIds(
    userId: string,
    transaction: Parameters<
      Parameters<SqlDatabase['withTransaction']>[0]
    >[0],
  ): Promise<string[]> {
    const rows = await transaction.query<{ branch_id: string }>(
      'SELECT branch_id FROM user_branch_access WHERE user_id = ? ORDER BY branch_id',
      [userId],
    )
    return rows.map((row) => row.branch_id)
  }

  private async getWarehouseIds(
    userId: string,
    transaction: Parameters<
      Parameters<SqlDatabase['withTransaction']>[0]
    >[0],
  ): Promise<string[]> {
    const rows = await transaction.query<{ warehouse_id: string }>(
      'SELECT warehouse_id FROM user_warehouse_access WHERE user_id = ? ORDER BY warehouse_id',
      [userId],
    )
    return rows.map((row) => row.warehouse_id)
  }

  private async assertNoDuplicateIds(input: {
    branchIds: readonly string[]
    warehouseIds: readonly string[]
  }): Promise<void> {
    await Promise.all([
      this.assertNoDuplicateValues(input.branchIds),
      this.assertNoDuplicateValues(input.warehouseIds),
    ])
  }

  private async assertNoDuplicateValues(values: readonly string[]) {
    if (new Set(values).size !== values.length) {
      throw new AuthorizationError('Duplicate values are not allowed')
    }
  }
}
