import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { AppConfig } from '../config.js'
import { prisma } from '../database.js'
import { HttpError } from '../errors.js'
import { permissionDescriptions, systemRoles } from './permissions.js'
import { hashPassword, verifyPassword } from './password.js'
import {
  createAccessToken,
  createRefreshToken,
  hashToken,
  verifyToken,
} from './tokens.js'

const credentialsSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
  password: z.string().min(12).max(128),
})

const setupSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1).max(120),
})

const ownProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  currentPassword: z.string().min(12).max(128).optional(),
  newPassword: z.string().min(12).max(128).optional(),
}).refine(
  (value) => Boolean(value.currentPassword) === Boolean(value.newPassword),
  'Current and new passwords must be provided together',
)

const roleNames: Record<(typeof systemRoles)[number], string> = {
  system_owner: 'System owner',
  general_manager: 'General manager',
  branch_manager: 'Branch manager',
  warehouse_manager: 'Warehouse manager',
  sales_employee: 'Sales employee',
  purchasing_employee: 'Purchasing employee',
  accountant: 'Accountant',
  manufacturing_employee: 'Manufacturing employee',
}

export type AuthPrincipal = {
  id: string
  username: string
  displayName: string
  roleCodes: string[]
  permissions: string[]
  branchIds: string[]
  warehouseIds: string[]
}

export type TokenPair = {
  accessToken: string
  refreshToken: string
  user: AuthPrincipal
}

export class AuthenticationService {
  constructor(private readonly config: AppConfig) {}

  async needsInitialOwnerSetup(): Promise<boolean> {
    return (await prisma.users.count()) === 0
  }

  async setupInitialOwner(input: unknown): Promise<TokenPair> {
    const parsed = setupSchema.safeParse(input)
    if (!parsed.success) {
      throw new HttpError(400, 'INVALID_SETUP', 'Initial owner details are invalid')
    }

    const passwordHash = await hashPassword(parsed.data.password)
    const user = await prisma.$transaction(async (transaction) => {
      if (await transaction.users.count() !== 0) {
        throw new HttpError(409, 'SETUP_COMPLETE', 'Initial owner setup has already been completed')
      }

      for (const [code, description] of Object.entries(permissionDescriptions)) {
        await transaction.permissions.upsert({
          where: { code },
          create: { code, description },
          update: { description },
        })
      }

      const roles = new Map<string, string>()
      for (const code of systemRoles) {
        const role = await transaction.roles.upsert({
          where: { code },
          create: {
            id: randomUUID(),
            code,
            name: roleNames[code],
            is_system: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          update: { name: roleNames[code], is_system: 1 },
        })
        roles.set(code, role.id)
      }
      const ownerRoleId = roles.get('system_owner')
      if (!ownerRoleId) throw new Error('System owner role could not be initialized')

      const owner = await transaction.users.create({
        data: {
          id: randomUUID(),
          username: parsed.data.username,
          password_hash: passwordHash,
          display_name: parsed.data.displayName,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          user_roles: { create: { role_id: ownerRoleId } },
        },
      })
      await transaction.role_permissions.createMany({
        data: Object.keys(permissionDescriptions).map((permissionCode) => ({
          role_id: ownerRoleId,
          permission_code: permissionCode,
        })),
        skipDuplicates: true,
      })
      const now = new Date().toISOString()
      await transaction.application_settings.upsert({
        where: { key: 'setup.completed' },
        create: { key: 'setup.completed', value: 'true', updated_at: now },
        update: { value: 'true', updated_at: now },
      })
      return owner
    }, { isolationLevel: 'Serializable' })

    return this.issueTokens(user.id)
  }

  async login(input: unknown): Promise<TokenPair> {
    const parsed = credentialsSchema.safeParse(input)
    if (!parsed.success) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect')

    const user = await prisma.users.findFirst({
      where: { username: { equals: parsed.data.username, mode: 'insensitive' } },
    })
    const passwordMatches = await verifyPassword(parsed.data.password, user?.password_hash ?? this.dummyHash())
    if (!user || user.status !== 'active' || !passwordMatches) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect')
    }
    return this.issueTokens(user.id)
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let claims: Awaited<ReturnType<typeof verifyToken>>
    try {
      claims = await verifyToken(refreshToken, this.config.jwtRefreshSecret, 'refresh')
    } catch {
      throw new HttpError(401, 'INVALID_SESSION', 'The session has expired; sign in again')
    }

    const existing = await prisma.auth_sessions.findUnique({
      where: { token_hash: hashToken(refreshToken) },
    })
    if (!existing || existing.user_id !== claims.userId || existing.revoked_at || existing.expires_at <= new Date()) {
      throw new HttpError(401, 'INVALID_SESSION', 'The session has expired; sign in again')
    }

    const principal = await this.getPrincipal(claims.userId)
    if (!principal) throw new HttpError(401, 'INVALID_SESSION', 'The user is no longer active')

    const nextRefresh = await createRefreshToken(claims.userId, this.config.jwtRefreshSecret)
    await prisma.$transaction(async (transaction) => {
      const result = await transaction.auth_sessions.updateMany({
        where: { id: existing.id, revoked_at: null, expires_at: { gt: new Date() } },
        data: { revoked_at: new Date() },
      })
      if (result.count !== 1) {
        throw new HttpError(401, 'INVALID_SESSION', 'The session has already been refreshed')
      }
      await transaction.auth_sessions.create({
        data: {
          id: nextRefresh.tokenId,
          user_id: claims.userId,
          token_hash: nextRefresh.tokenHash,
          expires_at: nextRefresh.expiresAt,
        },
      })
    })

    return {
      accessToken: await createAccessToken(claims.userId, this.config.jwtSecret),
      refreshToken: nextRefresh.token,
      user: principal,
    }
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return
    await prisma.auth_sessions.updateMany({
      where: { token_hash: hashToken(refreshToken), revoked_at: null },
      data: { revoked_at: new Date() },
    })
  }

  async updateOwnProfile(userId: string, input: unknown): Promise<TokenPair> {
    const parsed = ownProfileSchema.safeParse(input)
    if (!parsed.success) {
      throw new HttpError(400, 'INVALID_PROFILE', 'Profile details or password are invalid')
    }

    const existing = await prisma.users.findUnique({ where: { id: userId } })
    if (!existing || existing.status !== 'active') {
      throw new HttpError(401, 'UNAUTHORIZED', 'The user is no longer active')
    }

    const newPassword = parsed.data.newPassword
    const passwordChanged = newPassword !== undefined
    if (
      passwordChanged &&
      !(await verifyPassword(parsed.data.currentPassword ?? '', existing.password_hash))
    ) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'The current password is incorrect')
    }

    const passwordHash = newPassword
      ? await hashPassword(newPassword)
      : existing.password_hash
    const now = new Date().toISOString()

    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.users.updateMany({
        where: {
          id: userId,
          status: 'active',
          password_hash: existing.password_hash,
        },
        data: {
          display_name: parsed.data.displayName,
          password_hash: passwordHash,
          updated_at: now,
        },
      })
      if (updated.count !== 1) {
        throw new HttpError(409, 'PROFILE_CHANGED', 'The profile changed; reload and try again')
      }

      if (passwordChanged) {
        await transaction.auth_sessions.updateMany({
          where: { user_id: userId, revoked_at: null },
          data: { revoked_at: new Date(now) },
        })
      }

      await transaction.audit_logs.create({
        data: {
          id: randomUUID(),
          actor_user_id: userId,
          action: passwordChanged ? 'user.profile_and_password_updated' : 'user.profile_updated',
          entity_type: 'user',
          entity_id: userId,
          before_data: JSON.stringify({ displayName: existing.display_name }),
          after_data: JSON.stringify({ displayName: parsed.data.displayName }),
          occurred_at: now,
          created_at: now,
        },
      })
    })

    return this.issueTokens(userId)
  }

  async authenticate(accessToken: string): Promise<AuthPrincipal> {
    let claims: Awaited<ReturnType<typeof verifyToken>>
    try {
      claims = await verifyToken(accessToken, this.config.jwtSecret, 'access')
    } catch {
      throw new HttpError(401, 'UNAUTHORIZED', 'A valid access token is required')
    }
    const principal = await this.getPrincipal(claims.userId)
    if (!principal) throw new HttpError(401, 'UNAUTHORIZED', 'The user is no longer active')
    return principal
  }

  private async issueTokens(userId: string): Promise<TokenPair> {
    const user = await this.getPrincipal(userId)
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'The user is no longer active')
    const refresh = await createRefreshToken(userId, this.config.jwtRefreshSecret)
    await prisma.auth_sessions.create({
      data: {
        id: refresh.tokenId,
        user_id: userId,
        token_hash: refresh.tokenHash,
        expires_at: refresh.expiresAt,
      },
    })
    return {
      accessToken: await createAccessToken(userId, this.config.jwtSecret),
      refreshToken: refresh.token,
      user,
    }
  }

  private async getPrincipal(userId: string): Promise<AuthPrincipal | null> {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: {
        user_roles: { include: { roles: { include: { role_permissions: true } } } },
        user_branch_access: true,
        user_warehouse_access: true,
      },
    })
    if (!user || user.status !== 'active') return null
    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      roleCodes: user.user_roles.map(({ roles }) => roles.code),
      permissions: [...new Set(user.user_roles.flatMap(({ roles }) =>
        roles.role_permissions.map(({ permission_code }) => permission_code),
      ))].sort(),
      branchIds: user.user_branch_access.map(({ branch_id }) => branch_id),
      warehouseIds: user.user_warehouse_access.map(({ warehouse_id }) => warehouse_id),
    }
  }

  private dummyHash(): string {
    return `pbkdf2-sha256$600000$${'0'.repeat(32)}$${'0'.repeat(64)}`
  }
}
