import { z } from 'zod'

export const systemRoleCodes = [
  'system_owner',
  'general_manager',
  'branch_manager',
  'warehouse_manager',
  'sales_employee',
  'purchasing_employee',
  'accountant',
  'manufacturing_employee',
] as const

export type SystemRoleCode = (typeof systemRoleCodes)[number]

export const permissionCodes = [
  'products.read',
  'products.create',
  'products.update',
  'products.delete',
  'sales.read',
  'sales.create',
  'sales.cancel',
  'sales.discount',
  'sales.returns',
  'purchases.read',
  'purchases.create',
  'purchases.returns',
  'inventory.read',
  'inventory.adjust',
  'inventory.transfer',
  'inventory.count',
  'customers.manage',
  'suppliers.manage',
  'accounting.read',
  'accounting.manage',
  'reports.read',
  'users.manage',
  'roles.manage',
  'settings.manage',
  'manufacturing.manage',
] as const

export type PermissionCode = (typeof permissionCodes)[number]

export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
  password: z.string().min(12).max(128),
})

export const initialOwnerSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1).max(120),
})

export const userInputSchema = initialOwnerSchema.extend({
  roleCodes: z.array(z.string().min(1)).min(1),
  branchIds: z.array(z.string().uuid()),
  warehouseIds: z.array(z.string().uuid()),
})

export type CredentialsInput = z.input<typeof credentialsSchema>
export type InitialOwnerInput = z.input<typeof initialOwnerSchema>
export type UserInput = z.input<typeof userInputSchema>

export interface AuthenticatedUser {
  id: string
  username: string
  displayName: string
  roleCodes: readonly string[]
  permissions: readonly string[]
  branchIds: readonly string[]
  warehouseIds: readonly string[]
}

export function isGlobalBranchAdmin(roleCodes: readonly string[]): boolean {
  return roleCodes.some((role) =>
    ['system_owner', 'general_manager', 'admin'].includes(role),
  )
}

export interface PasswordHasher {
  hash(password: string): Promise<string>
  verify(password: string, encodedHash: string): Promise<boolean>
}
