import { z } from 'zod'
import { DatabaseError } from '../../infrastructure/database/errors'
import { createUuid } from '../../infrastructure/database/uuid'
import type { SqlDatabase } from '../../infrastructure/database/types'
import { AuthRepository } from './AuthRepository'
import { AuthenticationError, InitialSetupError } from './auth.errors'
import {
  credentialsSchema,
  initialOwnerSchema,
  type AuthenticatedUser,
  type CredentialsInput,
  type InitialOwnerInput,
  type PasswordHasher,
} from './auth.types'
import {
  zustandSessionStore,
  type SessionStore,
} from './session-store'

const DUMMY_PASSWORD_HASH =
  'pbkdf2-sha256$600000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000'

export class AuthenticationService {
  private readonly database: SqlDatabase
  private readonly repository: AuthRepository
  private readonly passwordHasher: PasswordHasher
  private readonly sessionStore: SessionStore

  constructor(
    database: SqlDatabase,
    passwordHasher: PasswordHasher,
    sessionStore: SessionStore = zustandSessionStore,
  ) {
    this.database = database
    this.repository = new AuthRepository(database)
    this.passwordHasher = passwordHasher
    this.sessionStore = sessionStore
  }

  async initialize(): Promise<void> {
    await this.repository.seedAuthorizationCatalog()
  }

  async needsInitialOwnerSetup(): Promise<boolean> {
    return (await this.repository.countUsers()) === 0
  }

  async setupInitialOwner(
    input: InitialOwnerInput,
  ): Promise<AuthenticatedUser> {
    const parsed = initialOwnerSchema.safeParse(input)
    if (!parsed.success) {
      throw new InitialSetupError('Initial owner details are invalid')
    }

    await this.initialize()

    const passwordHash = await this.passwordHasher.hash(
      parsed.data.password,
    )
    const now = new Date().toISOString()
    const userId = createUuid()

    await this.database.withTransaction(async (transaction) => {
      if ((await this.repository.countUsers(transaction)) !== 0) {
        throw new InitialSetupError(
          'Initial owner setup has already been completed',
        )
      }

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

      const ownerRoleId =
        await this.repository.getSystemOwnerRoleId(transaction)
      await this.repository.assignRoles(userId, [ownerRoleId], transaction)

      const permissions =
        await this.repository.getPermissions(transaction)
      await this.repository.setRolePermissions(
        ownerRoleId,
        permissions,
        transaction,
      )

      await transaction.run(
        `INSERT INTO application_settings (key, value, updated_at)
         VALUES ('setup.completed', 'true', ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
        [now],
      )

      await this.repository.writeAudit(
        {
          actorUserId: userId,
          action: 'initial_owner.created',
          entityType: 'user',
          entityId: userId,
          afterData: JSON.stringify({
            username: parsed.data.username,
            role: 'system_owner',
          }),
          occurredAt: now,
        },
        transaction,
      )
    })

    const principal = await this.repository.getPrincipal(userId)
    if (!principal) {
      throw new DatabaseError('Initial owner could not be loaded after setup')
    }

    this.sessionStore.establishSession(principal)
    return principal
  }

  async login(input: CredentialsInput): Promise<AuthenticatedUser> {
    const parsed = credentialsSchema.safeParse(input)
    if (!parsed.success) {
      throw new AuthenticationError()
    }

    const user = await this.repository.findUserByUsername(
      parsed.data.username,
    )
    const encodedHash = user?.password_hash ?? DUMMY_PASSWORD_HASH
    const passwordMatches = await this.passwordHasher.verify(
      parsed.data.password,
      encodedHash,
    )

    if (!user || user.status !== 'active' || !passwordMatches) {
      throw new AuthenticationError()
    }

    const principal = await this.repository.getPrincipal(user.id)
    if (!principal) {
      throw new AuthenticationError()
    }

    this.sessionStore.establishSession(principal)
    return principal
  }

  logout(): void {
    this.sessionStore.clearSession()
  }

  async changeOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const passwordSchema = z.string().min(12).max(128)
    const parsedNewPassword = passwordSchema.safeParse(newPassword)
    if (!parsedNewPassword.success) {
      throw new InitialSetupError('The new password does not meet requirements')
    }

    const principal = await this.repository.findUserById(userId)
    if (!principal || !(await this.passwordHasher.verify(
      currentPassword,
      principal.password_hash,
    ))) {
      throw new AuthenticationError()
    }

    const passwordHash = await this.passwordHasher.hash(
      parsedNewPassword.data,
    )
    await this.database.withTransaction(async (transaction) => {
      await this.repository.updatePassword(
        userId,
        passwordHash,
        new Date().toISOString(),
        transaction,
      )
      await this.repository.writeAudit(
        {
          actorUserId: userId,
          action: 'user.password_changed',
          entityType: 'user',
          entityId: userId,
          occurredAt: new Date().toISOString(),
        },
        transaction,
      )
    })
    this.sessionStore.clearSession()
  }
}
