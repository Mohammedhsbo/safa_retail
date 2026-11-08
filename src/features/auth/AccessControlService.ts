import { AuthRepository } from './AuthRepository'
import { AuthorizationError } from './auth.errors'
import type { PermissionCode } from './auth.types'
import type { SqlExecutor } from '../../infrastructure/database/types'
import type { SqlDatabase } from '../../infrastructure/database/types'

export class AccessControlService {
  private readonly repository: AuthRepository
  private readonly database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.database = database
    this.repository = new AuthRepository(database)
  }

  async assertPermission(
    userId: string,
    permission: PermissionCode,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    const principal = await this.repository.getPrincipal(userId, executor)

    if (!principal || !principal.permissions.includes(permission)) {
      throw new AuthorizationError(
        `Permission required: ${permission}`,
      )
    }
  }

  async assertBranchAccess(
    userId: string,
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    const principal = await this.repository.getPrincipal(userId, executor)

    if (
      !principal ||
      !(await this.repository.hasActiveBranch(branchId, executor)) ||
      (!principal.roleCodes.includes('system_owner') &&
        !(await this.repository.hasBranchAccess(userId, branchId, executor)))
    ) {
      throw new AuthorizationError('The user cannot access this branch')
    }
  }

  async assertWarehouseAccess(
    userId: string,
    warehouseId: string,
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    const principal = await this.repository.getPrincipal(userId, executor)

    if (!principal) {
      throw new AuthorizationError('The user is not active')
    }

    if (principal.roleCodes.includes('system_owner')) {
      const actualBranchId = await this.repository.getWarehouseBranch(
        warehouseId,
        executor,
      )
      if (actualBranchId !== branchId) {
        throw new AuthorizationError(
          'The warehouse does not belong to the requested branch',
        )
      }
      return
    }

    if (
      !(await this.repository.hasWarehouseAccess(
        userId,
        warehouseId,
        branchId,
        executor,
      ))
    ) {
      throw new AuthorizationError('The user cannot access this warehouse')
    }
  }

  async assertWarehousePermission(
    userId: string,
    permission: PermissionCode,
    warehouseId: string,
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await this.assertPermission(userId, permission, executor)
    await this.assertWarehouseAccess(userId, warehouseId, branchId, executor)
  }
}
