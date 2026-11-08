// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createUuid } from '../../infrastructure/database/uuid'
import {
  initializeDatabase,
} from '../../infrastructure/database/setup'
import { SqliteDatabase } from '../../infrastructure/database/SqliteDatabase'
import { BetterSqliteTestDriver } from '../../test/database/BetterSqliteTestDriver'
import { AccessControlService } from './AccessControlService'
import { AuthRepository } from './AuthRepository'
import { AuthenticationService } from './AuthenticationService'
import { AuthenticationError, AuthorizationError } from './auth.errors'
import { Pbkdf2PasswordHasher } from './PasswordHasher'
import { RoleManagementService } from './RoleManagementService'
import { useSessionStore } from './session-store'
import { UserManagementService } from './UserManagementService'
import type { PasswordHasher } from './auth.types'

class TestPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const digest = createHash('sha256').update(password).digest('hex')
    return `test-hash$${digest}`
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    return encodedHash === (await this.hash(password))
  }
}

let database: SqliteDatabase
let passwordHasher: PasswordHasher
let authentication: AuthenticationService
let repository: AuthRepository
let ownerId: string

async function createOwner() {
  const owner = await authentication.setupInitialOwner({
    username: 'owner',
    displayName: 'Owner',
    password: 'a-secure-owner-password',
  })

  ownerId = owner.id
  return owner
}

async function createBranchAndWarehouse() {
  const branchId = createUuid()
  const warehouseId = createUuid()
  const unitId = createUuid()
  const now = new Date().toISOString()

  await database.run(
    `INSERT INTO branches (id, code, name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [branchId, `branch-${branchId.slice(0, 6)}`, 'Branch', 'active', now, now],
  )
  await database.run(
    `INSERT INTO warehouses (id, branch_id, code, name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      warehouseId,
      branchId,
      `warehouse-${warehouseId.slice(0, 6)}`,
      'Warehouse',
      'active',
      now,
      now,
    ],
  )
  await database.run(
    `INSERT INTO measurement_units
       (id, code, name, dimension, decimal_places, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [unitId, `u${unitId.slice(0, 6)}`, 'Each', 'count', 0, 'active', now, now],
  )

  return { branchId, warehouseId, unitId }
}

async function createEmployee(
  input: {
    username?: string
    roleCode?: string
    branchIds?: string[]
    warehouseIds?: string[]
  } = {},
) {
  const users = new UserManagementService(database, passwordHasher)
  return users.createUser(ownerId, {
    username: input.username ?? 'employee',
    displayName: 'Employee',
    password: 'a-secure-employee-password',
    roleCodes: [input.roleCode ?? 'sales_employee'],
    branchIds: input.branchIds ?? [],
    warehouseIds: input.warehouseIds ?? [],
  })
}

beforeEach(async () => {
  database = new SqliteDatabase(new BetterSqliteTestDriver())
  await database.open()
  await initializeDatabase(database)
  passwordHasher = new TestPasswordHasher()
  authentication = new AuthenticationService(database, passwordHasher)
  repository = new AuthRepository(database)
  ownerId = ''
  useSessionStore.getState().clearSession()
})

afterEach(async () => {
  useSessionStore.getState().clearSession()
  await database.close()
})

describe('local authentication and permissions', () => {
  it('hashes passwords with salted PBKDF2 and verifies without plaintext storage', async () => {
    const hasher = new Pbkdf2PasswordHasher()
    const firstHash = await hasher.hash('correct horse battery staple')
    const secondHash = await hasher.hash('correct horse battery staple')

    expect(firstHash).toMatch(/^pbkdf2-sha256\$600000\$/)
    expect(firstHash).not.toContain('correct horse battery staple')
    expect(firstHash).not.toBe(secondHash)
    await expect(
      hasher.verify('correct horse battery staple', firstHash),
    ).resolves.toBe(true)
    await expect(hasher.verify('wrong password', firstHash)).resolves.toBe(
      false,
    )
    await expect(hasher.hash('short')).rejects.toThrow()
    expect(() => new Pbkdf2PasswordHasher(1000)).toThrow()
  })

  it('requires explicit one-time first-owner setup and never seeds credentials', async () => {
    const rolesBeforeSetup = await repository.getRoles()
    expect(rolesBeforeSetup).toEqual([])
    expect(await authentication.needsInitialOwnerSetup()).toBe(true)

    const owner = await createOwner()
    const storedOwner = await repository.findUserById(owner.id)

    expect(owner.roleCodes).toEqual(['system_owner'])
    expect(owner.permissions).toContain('users.manage')
    expect(owner.permissions).toContain('roles.manage')
    expect(storedOwner?.password_hash).toBe(
      await passwordHasher.hash('a-secure-owner-password'),
    )
    expect(storedOwner?.password_hash).not.toContain(
      'a-secure-owner-password',
    )
    expect(await authentication.needsInitialOwnerSetup()).toBe(false)
    expect(useSessionStore.getState().user?.id).toBe(owner.id)

    await expect(
      authentication.setupInitialOwner({
        username: 'second',
        displayName: 'Second Owner',
        password: 'a-secure-second-password',
      }),
    ).rejects.toThrow(/already been completed/)
    expect(await repository.countUsers()).toBe(1)
  })

  it('uses generic login errors, normalizes usernames, and clears memory sessions on logout', async () => {
    await createOwner()
    const signedIn = await authentication.login({
      username: ' OWNER ',
      password: 'a-secure-owner-password',
    })

    expect(signedIn.username).toBe('owner')
    expect(useSessionStore.getState().user?.id).toBe(ownerId)

    await expect(
      authentication.login({
        username: 'missing',
        password: 'a-secure-owner-password',
      }),
    ).rejects.toThrow(AuthenticationError)
    await expect(
      authentication.login({
        username: 'owner',
        password: 'a-different-owner-password',
      }),
    ).rejects.toThrow('Invalid username or password')

    authentication.logout()
    expect(useSessionStore.getState()).toMatchObject({
      user: null,
      startedAt: null,
    })
  })

  it('rejects login for disabled users and removes a changed-password session', async () => {
    await createOwner()
    const employeeId = await createEmployee()
    const users = new UserManagementService(database, passwordHasher)

    await users.setUserStatus(ownerId, employeeId, 'disabled')
    await expect(
      authentication.login({
        username: 'employee',
        password: 'a-secure-employee-password',
      }),
    ).rejects.toThrow(AuthenticationError)

    await users.setUserStatus(ownerId, employeeId, 'active')
    await authentication.login({
      username: 'employee',
      password: 'a-secure-employee-password',
    })
    expect(useSessionStore.getState().user?.id).toBe(employeeId)

    await authentication.changeOwnPassword(
      employeeId,
      'a-secure-employee-password',
      'a-secure-new-password',
    )
    expect(useSessionStore.getState().user).toBeNull()
    await expect(
      authentication.login({
        username: 'employee',
        password: 'a-secure-employee-password',
      }),
    ).rejects.toThrow(AuthenticationError)
    await expect(
      authentication.login({
        username: 'employee',
        password: 'a-secure-new-password',
      }),
    ).resolves.toMatchObject({ id: employeeId })
  })

  it('lets a user manager update another account and reset its password', async () => {
    await createOwner()
    const employeeId = await createEmployee()
    const users = new UserManagementService(database, passwordHasher)

    await users.updateUserAccount(ownerId, employeeId, {
      username: 'new.employee',
      displayName: 'Updated Employee',
    })
    await users.resetPassword(ownerId, employeeId, 'a-secure-updated-password')

    expect(await users.listUsers(ownerId)).toContainEqual(expect.objectContaining({
      id: employeeId,
      username: 'new.employee',
      displayName: 'Updated Employee',
    }))
    await expect(users.updateUserAccount(employeeId, employeeId, {
      username: 'new.employee',
      displayName: 'Unauthorized Update',
    })).rejects.toThrow(AuthorizationError)
    await expect(authentication.login({
      username: 'new.employee',
      password: 'a-secure-updated-password',
    })).resolves.toMatchObject({ id: employeeId, displayName: 'Updated Employee' })
  })

  it('seeds system roles with no default non-owner permission grants', async () => {
    await authentication.initialize()
    const roles = await repository.getRoles()
    const expectedRoleCodes = [
      'accountant',
      'branch_manager',
      'general_manager',
      'manufacturing_employee',
      'purchasing_employee',
      'sales_employee',
      'system_owner',
      'warehouse_manager',
    ]

    expect(roles.map((role) => role.code)).toEqual(expectedRoleCodes)

    for (const role of roles.filter((item) => item.code !== 'system_owner')) {
      expect(await repository.getRolePermissionCodes(role.id)).toEqual([])
    }

    const ownerRole = roles.find((role) => role.code === 'system_owner')
    expect(ownerRole).toBeDefined()
    expect(
      await repository.getRolePermissionCodes(ownerRole!.id),
    ).toContain('users.manage')
  })

  it('enforces user management, permission grants, and warehouse/branch scope in services', async () => {
    await createOwner()
    const { branchId, warehouseId } = await createBranchAndWarehouse()
    const employeeId = await createEmployee({
      branchIds: [branchId],
      warehouseIds: [warehouseId],
    })
    const access = new AccessControlService(database)
    const roles = new RoleManagementService(database)
    const users = new UserManagementService(database, passwordHasher)

    await expect(access.assertPermission(employeeId, 'inventory.read')).rejects
      .toThrow(AuthorizationError)
    await expect(users.listUsers(employeeId)).rejects.toThrow(
      AuthorizationError,
    )

    const role = (await roles.listRoles(ownerId)).find(
      (item) => item.code === 'sales_employee',
    )
    expect(role).toBeDefined()
    await roles.setPermissions(ownerId, role!.id, ['inventory.read'])

    await access.assertPermission(employeeId, 'inventory.read')
    await access.assertBranchAccess(employeeId, branchId)
    await access.assertWarehousePermission(
      employeeId,
      'inventory.read',
      warehouseId,
      branchId,
    )

    await expect(
      access.assertBranchAccess(employeeId, createUuid()),
    ).rejects.toThrow(/cannot access this branch/)
    await expect(
      access.assertWarehouseAccess(
        employeeId,
        warehouseId,
        createUuid(),
      ),
    ).rejects.toThrow(/cannot access this warehouse/)
  })

  it('rejects cross-branch warehouse assignments and protects the last owner', async () => {
    await createOwner()
    const first = await createBranchAndWarehouse()
    const second = await createBranchAndWarehouse()
    const users = new UserManagementService(database, passwordHasher)

    await expect(
      users.createUser(ownerId, {
        username: 'bademployee',
        displayName: 'Bad Employee',
        password: 'a-secure-employee-password',
        roleCodes: ['sales_employee'],
        branchIds: [first.branchId],
        warehouseIds: [second.warehouseId],
      }),
    ).rejects.toThrow(/must belong to an active assigned branch/)
    expect(await repository.countUsers()).toBe(1)

    await expect(
      users.setUserStatus(ownerId, ownerId, 'disabled'),
    ).rejects.toThrow(/last active system owner/)
    await expect(
      users.assignRoles(ownerId, ownerId, ['sales_employee']),
    ).rejects.toThrow(/System owner roles cannot be changed/)
    expect(await repository.countUsers()).toBe(1)
  })

  it('prevents non-owner role managers from granting permissions they lack', async () => {
    await createOwner()
    const roles = new RoleManagementService(database)
    const users = new UserManagementService(database, passwordHasher)
    const roleManagerId = await roles.createRole(ownerId, 'Role manager')
    await roles.setPermissions(ownerId, roleManagerId, ['roles.manage'])
    expect(await roles.getRolePermissions(ownerId, roleManagerId)).toEqual(['roles.manage'])
    const roleManager = await createEmployee({
      username: 'rolemanager',
      roleCode: (
        await repository.getRoles()
      ).find((role) => role.id === roleManagerId)!.code,
    })
    const targetId = await createEmployee({
      username: 'targetuser',
    })
    const usersRole = (await roles.listRoles(ownerId)).find(
      (role) => role.code === 'sales_employee',
    )

    await expect(
      roles.setPermissions(roleManager, usersRole!.id, ['users.manage']),
    ).rejects.toThrow(/cannot grant permissions they do not have/)
    await expect(
      users.assignRoles(ownerId, targetId, ['system_owner']),
    ).rejects.toThrow(
      /system owner role can only be assigned during secure initial setup/,
    )
  })

  it('changes assignments atomically and records security-sensitive changes', async () => {
    await createOwner()
    const location = await createBranchAndWarehouse()
    const employeeId = await createEmployee()
    const users = new UserManagementService(database, passwordHasher)

    await users.setUserAccess(
      ownerId,
      employeeId,
      [location.branchId],
      [location.warehouseId],
    )
    const principal = await repository.getPrincipal(employeeId)

    expect(principal?.branchIds).toEqual([location.branchId])
    expect(principal?.warehouseIds).toEqual([location.warehouseId])

    const auditRows = await database.query<{ action: string }>(
      'SELECT action FROM audit_logs ORDER BY occurred_at',
    )
    expect(auditRows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'initial_owner.created',
        'user.created',
        'user.access_updated',
      ]),
    )
    expect(JSON.stringify(auditRows)).not.toContain(
      'a-secure-owner-password',
    )
  })
})
