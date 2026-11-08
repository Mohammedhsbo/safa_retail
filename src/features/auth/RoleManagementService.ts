import { z } from 'zod'
import { createUuid } from '../../infrastructure/database/uuid'
import type { SqlDatabase } from '../../infrastructure/database/types'
import { AccessControlService } from './AccessControlService'
import { AuthRepository } from './AuthRepository'
import { AuthorizationError } from './auth.errors'
import { permissionCodes, type PermissionCode } from './auth.types'

const roleNameSchema = z.string().trim().min(2).max(80)
const rolePermissionsSchema = z.array(z.enum(permissionCodes))

export class RoleManagementService {
  private readonly database: SqlDatabase
  private readonly repository: AuthRepository
  private readonly access: AccessControlService

  constructor(database: SqlDatabase) {
    this.database = database
    this.repository = new AuthRepository(database)
    this.access = new AccessControlService(database)
  }

  async listRoles(actorId: string) {
    await this.access.assertPermission(actorId, 'roles.manage')
    return this.repository.getRoles()
  }

  async listPermissions(actorId: string): Promise<PermissionCode[]> {
    await this.access.assertPermission(actorId, 'roles.manage')
    return this.repository.getPermissions()
  }

  async getRolePermissions(actorId: string, roleId: string): Promise<PermissionCode[]> {
    await this.access.assertPermission(actorId, 'roles.manage')
    const role = (await this.repository.getRoles()).find((item) => item.id === roleId)
    if (!role) {
      throw new AuthorizationError('The selected role does not exist')
    }
    return this.repository.getRolePermissionCodes(roleId)
  }

  async createRole(actorId: string, name: string): Promise<string> {
    const parsedName = roleNameSchema.safeParse(name)
    if (!parsedName.success) {
      throw new AuthorizationError('The role name is invalid')
    }

    const id = createUuid()
    const now = new Date().toISOString()
    const suffix = id.replaceAll('-', '').slice(0, 12)

    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'roles.manage',
        transaction,
      )
      await transaction.run(
        `INSERT INTO roles (id, code, name, is_system, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
        [id, `custom_${suffix}`, parsedName.data, now, now],
      )
      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'role.created',
          entityType: 'role',
          entityId: id,
          afterData: JSON.stringify({
            code: `custom_${suffix}`,
            name: parsedName.data,
          }),
          occurredAt: now,
        },
        transaction,
      )
    })

    return id
  }

  async setPermissions(
    actorId: string,
    roleId: string,
    input: readonly string[],
  ): Promise<void> {
    const parsed = rolePermissionsSchema.safeParse(input)
    if (!parsed.success || new Set(input).size !== input.length) {
      throw new AuthorizationError(
        'The permission list contains an invalid or duplicate permission',
      )
    }

    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'roles.manage',
        transaction,
      )

      const roles = await this.repository.getRoles(transaction)
      const role = roles.find((item) => item.id === roleId)
      if (!role) {
        throw new AuthorizationError('The selected role does not exist')
      }
      if (role.code === 'system_owner') {
        throw new AuthorizationError(
          'System owner permissions cannot be changed',
        )
      }

      const actor = await this.repository.getPrincipal(actorId, transaction)
      if (!actor) {
        throw new AuthorizationError('The acting user is not active')
      }
      if (
        !actor.roleCodes.includes('system_owner') &&
        parsed.data.some((permission) => !actor.permissions.includes(permission))
      ) {
        throw new AuthorizationError(
          'The acting user cannot grant permissions they do not have',
        )
      }

      const before = await this.repository.getRolePermissionCodes(
        roleId,
        transaction,
      )
      await this.repository.setRolePermissions(
        roleId,
        parsed.data,
        transaction,
      )
      await transaction.run(
        'UPDATE roles SET updated_at = ? WHERE id = ?',
        [now, roleId],
      )
      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'role.permissions_updated',
          entityType: 'role',
          entityId: roleId,
          beforeData: JSON.stringify({ permissions: before }),
          afterData: JSON.stringify({ permissions: parsed.data }),
          occurredAt: now,
        },
        transaction,
      )
    })
  }
}
