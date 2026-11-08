import { z } from 'zod'
import { createUuid } from '../../infrastructure/database/uuid'
import type { SqlDatabase, SqlExecutor, SqlRow } from '../../infrastructure/database/types'
import { AccessControlService } from '../auth/AccessControlService'
import { AuthRepository } from '../auth/AuthRepository'
import { ApplicationSettingsRepository } from '../../infrastructure/database/repositories/ApplicationSettingsRepository'
import { OrganizationError } from './organization.errors'
import { OrganizationRepository } from './OrganizationRepository'

const locationCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/)
const locationNameSchema = z.string().trim().min(1).max(120)
const optionalContactSchema = z
  .string()
  .trim()
  .max(254)
  .nullable()
  .optional()

const branchInputSchema = z.object({
  code: locationCodeSchema,
  name: locationNameSchema,
  address: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
})

const branchUpdateSchema = branchInputSchema.extend({
  address: z.string().trim().max(500).nullable(),
  phone: z.string().trim().max(40).nullable(),
})

const warehouseInputSchema = z.object({
  branchId: z.string().uuid(),
  code: locationCodeSchema,
  name: locationNameSchema,
})

const organizationProfileSchema = z.object({
  name: z.string().trim().min(1).max(160).nullable(),
  address: z.string().trim().max(500).nullable(),
  phone: z.string().trim().max(40).nullable(),
  email: z.string().trim().email().max(254).nullable(),
})

const organizationProfileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: optionalContactSchema.pipe(z.string().email().max(254).nullable().optional()),
}).refine((value) => Object.keys(value).length > 0)

const branchRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  created_at: z.string(),
  updated_at: z.string(),
})

const warehouseRowSchema = z.object({
  id: z.string().uuid(),
  branch_id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  status: z.enum(['active', 'archived']),
  created_at: z.string(),
  updated_at: z.string(),
})

export type Branch = {
  id: string
  code: string
  name: string
  address: string | null
  phone: string | null
  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
}

export type Warehouse = {
  id: string
  branchId: string
  code: string
  name: string
  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
}

export type OrganizationProfile = z.infer<typeof organizationProfileSchema>

const defaultOrganizationProfile: OrganizationProfile = {
  name: null,
  address: null,
  phone: null,
  email: null,
}

const organizationProfileSettingKey = 'organization.profile'

export class OrganizationService {
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

  async getProfile(actorId: string): Promise<OrganizationProfile> {
    await this.access.assertPermission(actorId, 'settings.manage')
    const settings = new ApplicationSettingsRepository(this.database)
    return this.getProfileFromSettings(settings)
  }

  async updateProfile(actorId: string, input: unknown): Promise<void> {
    const parsed = organizationProfileUpdateSchema.safeParse(input)
    if (!parsed.success) {
      throw new OrganizationError('The organization profile is invalid')
    }

    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'settings.manage',
        transaction,
      )
      const settings = new ApplicationSettingsRepository(transaction)
      const previous = await this.getProfileFromSettings(settings)
      const next = organizationProfileSchema.parse({
        ...previous,
        ...parsed.data,
      })
      await settings.set(
        organizationProfileSettingKey,
        JSON.stringify(next),
      )
      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'organization.profile_updated',
          entityType: 'organization',
          entityId: 'organization',
          beforeData: JSON.stringify(previous),
          afterData: JSON.stringify(next),
          occurredAt: now,
        },
        transaction,
      )
    })
  }

  async listBranches(actorId: string): Promise<Branch[]> {
    await this.access.assertPermission(actorId, 'settings.manage')
    const rows = await this.organizationRepository.listBranches()
    return rows.map((row) => this.parseBranch(row))
  }

  async listAccessibleBranches(actorId: string): Promise<Branch[]> {
    const principal = await this.repository.getPrincipal(actorId)
    if (!principal) {
      throw new OrganizationError('The acting user is not active')
    }
    const rows = await this.organizationRepository.listBranches()
    return rows
      .map((row) => this.parseBranch(row))
      .filter((branch) =>
        branch.status === 'active' &&
        (principal.roleCodes.includes('system_owner') ||
          principal.branchIds.includes(branch.id)),
      )
  }

  async createBranch(actorId: string, input: unknown): Promise<string> {
    const parsed = branchInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new OrganizationError('The branch details are invalid')
    }

    const id = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'settings.manage',
        transaction,
      )
      await this.organizationRepository.createBranch(
        {
          id,
          code: parsed.data.code,
          name: parsed.data.name,
          address: parsed.data.address ?? null,
          phone: parsed.data.phone ?? null,
          createdAt: now,
        },
        transaction,
      )
      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'branch.created',
          entityType: 'branch',
          entityId: id,
          afterData: JSON.stringify(parsed.data),
          occurredAt: now,
        },
        transaction,
      )
    })
    return id
  }

  async updateBranch(
    actorId: string,
    branchId: string,
    input: unknown,
  ): Promise<void> {
    const parsed = branchUpdateSchema.safeParse(input)
    if (!parsed.success || !z.string().uuid().safeParse(branchId).success) {
      throw new OrganizationError('The branch details are invalid')
    }

    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'settings.manage',
        transaction,
      )
      const before = await this.getBranch(branchId, transaction)
      if (!before || before.status !== 'active') {
        throw new OrganizationError('The active branch does not exist')
      }

      await this.organizationRepository.updateBranch(
        branchId,
        {
          code: parsed.data.code,
          name: parsed.data.name,
          address: parsed.data.address,
          phone: parsed.data.phone,
        },
        now,
        transaction,
      )
      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'branch.updated',
          entityType: 'branch',
          entityId: branchId,
          beforeData: JSON.stringify(this.branchAuditData(before)),
          afterData: JSON.stringify(parsed.data),
          occurredAt: now,
        },
        transaction,
      )
    })
  }

  async archiveBranch(actorId: string, branchId: string): Promise<void> {
    if (!z.string().uuid().safeParse(branchId).success) {
      throw new OrganizationError('The branch identifier is invalid')
    }

    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'settings.manage',
        transaction,
      )
      const branch = await this.getBranch(branchId, transaction)
      if (!branch || branch.status !== 'active') {
        throw new OrganizationError('The active branch does not exist')
      }

      const warehouseRows = await this.organizationRepository.listWarehousesForBranch(
        branchId,
        transaction,
      )
      const warehouses = warehouseRows.map((row) =>
        this.parseWarehouse(row),
      )
      await this.organizationRepository.archiveBranch(
        branchId,
        now,
        transaction,
      )
      await this.organizationRepository.archiveWarehousesForBranch(
        branchId,
        now,
        transaction,
      )
      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'branch.archived',
          entityType: 'branch',
          entityId: branchId,
          beforeData: JSON.stringify({
            status: branch.status,
            activeWarehouseIds: warehouses
              .filter((warehouse) => warehouse.status === 'active')
              .map((warehouse) => warehouse.id),
          }),
          afterData: JSON.stringify({ status: 'archived' }),
          occurredAt: now,
        },
        transaction,
      )
      for (const warehouse of warehouses.filter(
        (item) => item.status === 'active',
      )) {
        await this.repository.writeAudit(
          {
            actorUserId: actorId,
            action: 'warehouse.archived',
            entityType: 'warehouse',
            entityId: warehouse.id,
            beforeData: JSON.stringify({ status: 'active' }),
            afterData: JSON.stringify({ status: 'archived', branchId }),
            occurredAt: now,
          },
          transaction,
        )
      }
    })
  }

  async listWarehouses(actorId: string): Promise<Warehouse[]> {
    await this.access.assertPermission(actorId, 'settings.manage')
    const rows = await this.organizationRepository.listWarehouses()
    return rows.map((row) => this.parseWarehouse(row))
  }

  async listAccessibleWarehouses(
    actorId: string,
    branchId: string,
  ): Promise<Warehouse[]> {
    await this.access.assertBranchAccess(actorId, branchId)
    const principal = await this.repository.getPrincipal(actorId)
    if (!principal) {
      throw new OrganizationError('The acting user is not active')
    }
    const rows = await this.organizationRepository.listWarehousesForBranch(branchId)
    return rows
      .map((row) => this.parseWarehouse(row))
      .filter((warehouse) =>
        warehouse.status === 'active' &&
        (principal.roleCodes.includes('system_owner') ||
          principal.warehouseIds.includes(warehouse.id)),
      )
  }

  async createWarehouse(actorId: string, input: unknown): Promise<string> {
    const parsed = warehouseInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new OrganizationError('The warehouse details are invalid')
    }

    const id = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'settings.manage',
        transaction,
      )
      await this.assertActiveBranch(parsed.data.branchId, transaction)
      await this.organizationRepository.createWarehouse(
        {
          id,
          branchId: parsed.data.branchId,
          code: parsed.data.code,
          name: parsed.data.name,
          createdAt: now,
        },
        transaction,
      )
      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'warehouse.created',
          entityType: 'warehouse',
          entityId: id,
          afterData: JSON.stringify(parsed.data),
          occurredAt: now,
        },
        transaction,
      )
    })
    return id
  }

  async updateWarehouse(
    actorId: string,
    warehouseId: string,
    input: unknown,
  ): Promise<void> {
    const parsed = warehouseInputSchema.safeParse(input)
    if (!parsed.success || !z.string().uuid().safeParse(warehouseId).success) {
      throw new OrganizationError('The warehouse details are invalid')
    }

    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'settings.manage',
        transaction,
      )
      const before = await this.getWarehouse(warehouseId, transaction)
      if (!before || before.status !== 'active') {
        throw new OrganizationError('The active warehouse does not exist')
      }
      await this.assertActiveBranch(parsed.data.branchId, transaction)

      if (before.branch_id !== parsed.data.branchId) {
        await this.assertWarehouseCanMove(warehouseId, transaction)
      }

      await this.organizationRepository.updateWarehouse(
        warehouseId,
        parsed.data,
        now,
        transaction,
      )
      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'warehouse.updated',
          entityType: 'warehouse',
          entityId: warehouseId,
          beforeData: JSON.stringify(this.warehouseAuditData(before)),
          afterData: JSON.stringify(parsed.data),
          occurredAt: now,
        },
        transaction,
      )
    })
  }

  async archiveWarehouse(actorId: string, warehouseId: string): Promise<void> {
    if (!z.string().uuid().safeParse(warehouseId).success) {
      throw new OrganizationError('The warehouse identifier is invalid')
    }

    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'settings.manage',
        transaction,
      )
      const warehouse = await this.getWarehouse(warehouseId, transaction)
      if (!warehouse || warehouse.status !== 'active') {
        throw new OrganizationError('The active warehouse does not exist')
      }

      await this.organizationRepository.archiveWarehouse(
        warehouseId,
        now,
        transaction,
      )
      await this.repository.writeAudit(
        {
          actorUserId: actorId,
          action: 'warehouse.archived',
          entityType: 'warehouse',
          entityId: warehouseId,
          beforeData: JSON.stringify({
            status: warehouse.status,
            branchId: warehouse.branch_id,
          }),
          afterData: JSON.stringify({ status: 'archived' }),
          occurredAt: now,
        },
        transaction,
      )
    })
  }

  private async assertActiveBranch(
    branchId: string,
    executor: SqlExecutor,
  ): Promise<void> {
    if (!(await this.organizationRepository.isBranchActive(branchId, executor))) {
      throw new OrganizationError('Warehouses require an active branch')
    }
  }

  private async assertWarehouseCanMove(
    warehouseId: string,
    executor: SqlExecutor,
  ): Promise<void> {
    if (
      await this.organizationRepository.warehouseHasUsageOrAssignments(
        warehouseId,
        executor,
      )
    ) {
      throw new OrganizationError(
        'A warehouse with operational history or user assignments cannot be moved',
      )
    }
  }

  private async getBranch(
    branchId: string,
    executor: SqlExecutor,
  ): Promise<Branch | null> {
    const row = await this.organizationRepository.getBranch(
      branchId,
      executor,
    )
    return row ? this.parseBranch(row) : null
  }

  private async getWarehouse(
    warehouseId: string,
    executor: SqlExecutor,
  ): Promise<ReturnType<typeof warehouseRowSchema.parse> | null> {
    const row = await this.organizationRepository.getWarehouse(
      warehouseId,
      executor,
    )
    return row ? this.parseWarehouseRow(row) : null
  }

  private async getProfileFromSettings(
    settings: ApplicationSettingsRepository,
  ): Promise<OrganizationProfile> {
    const value = await settings.get(organizationProfileSettingKey)
    if (value === null) {
      return defaultOrganizationProfile
    }

    let decoded: unknown
    try {
      decoded = JSON.parse(value)
    } catch {
      throw new OrganizationError('The saved organization profile is invalid')
    }
    const parsed = organizationProfileSchema.safeParse(decoded)
    if (!parsed.success) {
      throw new OrganizationError('The saved organization profile is invalid')
    }
    return parsed.data
  }

  private parseBranch(row: SqlRow): Branch {
    const parsed = branchRowSchema.safeParse(row)
    if (!parsed.success) {
      throw new OrganizationError('A branch record is invalid')
    }
    return {
      id: parsed.data.id,
      code: parsed.data.code,
      name: parsed.data.name,
      address: parsed.data.address,
      phone: parsed.data.phone,
      status: parsed.data.status,
      createdAt: parsed.data.created_at,
      updatedAt: parsed.data.updated_at,
    }
  }

  private parseWarehouse(row: SqlRow): Warehouse {
    const parsed = this.parseWarehouseRow(row)
    return {
      id: parsed.id,
      branchId: parsed.branch_id,
      code: parsed.code,
      name: parsed.name,
      status: parsed.status,
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at,
    }
  }

  private parseWarehouseRow(row: SqlRow) {
    const parsed = warehouseRowSchema.safeParse(row)
    if (!parsed.success) {
      throw new OrganizationError('A warehouse record is invalid')
    }
    return parsed.data
  }

  private branchAuditData(branch: Branch) {
    return {
      code: branch.code,
      name: branch.name,
      address: branch.address,
      phone: branch.phone,
      status: branch.status,
    }
  }

  private warehouseAuditData(
    warehouse: ReturnType<typeof warehouseRowSchema.parse>,
  ) {
    return {
      branchId: warehouse.branch_id,
      code: warehouse.code,
      name: warehouse.name,
      status: warehouse.status,
    }
  }
}
