import { z } from 'zod'
import { createUuid } from '../../infrastructure/database/uuid'
import type { SqlDatabase, SqlExecutor, SqlRow } from '../../infrastructure/database/types'
import { AccessControlService } from '../auth/AccessControlService'
import { AuthRepository } from '../auth/AuthRepository'
import { OrganizationError } from './organization.errors'
import { OrganizationRepository } from './OrganizationRepository'

const businessActivities = [
  { code: 'detergents_trading', name: 'Detergents Trading' },
  { code: 'fabrics_trading', name: 'Fabrics Trading' },
  { code: 'clothing_manufacturing', name: 'Clothing Manufacturing' },
] as const

const activityCodeSchema = z.enum(
  businessActivities.map((activity) => activity.code),
)

const activityRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  enabled: z.union([z.literal(0), z.literal(1)]),
  created_at: z.string(),
  updated_at: z.string(),
})

export type BusinessActivity = {
  id: string
  code: (typeof businessActivities)[number]['code']
  name: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export class BusinessConfigurationService {
  private readonly database: SqlDatabase
  private readonly access: AccessControlService
  private readonly repository: AuthRepository
  private readonly organizationRepository: OrganizationRepository

  constructor(database: SqlDatabase) {
    this.database = database
    this.access = new AccessControlService(database)
    this.repository = new AuthRepository(database)
    this.organizationRepository = new OrganizationRepository(database)
  }

  async initialize(): Promise<void> {
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.seedActivities(transaction, now)
    })
  }

  async listActivities(actorId: string): Promise<BusinessActivity[]> {
    await this.access.assertPermission(actorId, 'settings.manage')
    await this.initialize()

    const rows = await this.organizationRepository.listBusinessActivities()
    return rows.map((row) => this.parseActivity(row))
  }

  async setActivityEnabled(
    actorId: string,
    code: string,
    enabled: boolean,
  ): Promise<void> {
    const parsedCode = activityCodeSchema.safeParse(code)
    if (!parsedCode.success || typeof enabled !== 'boolean') {
      throw new OrganizationError('The business activity setting is invalid')
    }

    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'settings.manage',
        transaction,
      )
      await this.seedActivities(transaction, now)

      const before = await this.organizationRepository.getBusinessActivity(
        parsedCode.data,
        transaction,
      )
      if (!before) {
        throw new OrganizationError('The selected business activity does not exist')
      }

      await this.organizationRepository.setBusinessActivityEnabled(
        parsedCode.data,
        enabled,
        now,
        transaction,
      )

      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'business_activity.updated',
          entityType: 'business_activity',
          entityId: String(before.id),
          beforeData: JSON.stringify({
            code: parsedCode.data,
            enabled: before.enabled === 1,
          }),
          afterData: JSON.stringify({
            code: parsedCode.data,
            enabled,
          }),
          occurredAt: now,
        },
        transaction,
      )
    })
  }

  private async seedActivities(
    executor: SqlExecutor,
    createdAt: string,
  ): Promise<void> {
    for (const activity of businessActivities) {
      await this.organizationRepository.seedBusinessActivity(
        createUuid(),
        activity.code,
        activity.name,
        createdAt,
        executor,
      )
    }
  }

  private parseActivity(row: SqlRow): BusinessActivity {
    const parsed = activityRowSchema.safeParse(row)
    if (!parsed.success) {
      throw new OrganizationError('A business activity record is invalid')
    }

    const code = activityCodeSchema.safeParse(parsed.data.code)
    if (!code.success) {
      throw new OrganizationError(
        `The business activity catalog contains an unknown code: ${parsed.data.code}`,
      )
    }

    return {
      id: parsed.data.id,
      code: code.data,
      name: parsed.data.name,
      enabled: parsed.data.enabled === 1,
      createdAt: parsed.data.created_at,
      updatedAt: parsed.data.updated_at,
    }
  }
}
