import { createContext, useContext, type ReactNode } from 'react'
import { ApiClient } from '@safa/api-client'
import type { AuthenticatedUser } from '@safa/types'
import type { CredentialsInput, InitialOwnerInput } from '../features/auth/auth.types'
import { useSessionStore } from '../features/auth/session-store'
import type { AccountingService } from '../features/accounting/AccountingService'
import type { BackupPreview, BackupSchedule, BackupService } from '../features/backup/BackupService'
import type { DatabaseHealth } from '../infrastructure/database/types'
import type { ProductCatalogService } from '../features/catalog/ProductCatalogService'
import type { InventoryService } from '../features/inventory/InventoryService'
import type { ManufacturingService } from '../features/manufacturing/ManufacturingService'
import type { OrganizationService } from '../features/organization/OrganizationService'
import type { BusinessConfigurationService } from '../features/organization/BusinessConfigurationService'
import type { PurchasesService } from '../features/purchases/PurchasesService'
import type { ReportsService } from '../features/reports/ReportsService'
import type { SalesService } from '../features/sales/SalesService'
import type { RoleManagementService } from '../features/auth/RoleManagementService'
import type { UserManagementService } from '../features/auth/UserManagementService'

export type RemoteService<T extends object> = {
  [K in keyof T as T[K] extends (...args: infer _Args) => Promise<unknown> ? K : never]: T[K]
}

export type OnlineAuthentication = {
  needsInitialOwnerSetup(): Promise<boolean>
  restoreSession(): Promise<AuthenticatedUser | null>
  setupInitialOwner(input: InitialOwnerInput): Promise<AuthenticatedUser>
  login(input: CredentialsInput): Promise<AuthenticatedUser>
  updateOwnProfile(input: {
    displayName: string
    currentPassword?: string
    newPassword?: string
  }): Promise<AuthenticatedUser>
  logout(): Promise<void>
}

export type RetailApplicationServices = {
  apiClient: ApiClient
  authentication: OnlineAuthentication
  users: RemoteService<UserManagementService>
  roles: RemoteService<RoleManagementService>
  organization: RemoteService<OrganizationService>
  businessConfiguration: RemoteService<BusinessConfigurationService>
  catalog: RemoteService<ProductCatalogService>
  inventory: RemoteService<InventoryService>
  sales: RemoteService<SalesService>
  purchases: RemoteService<PurchasesService>
  accounting: RemoteService<AccountingService>
  manufacturing: RemoteService<ManufacturingService>
  reports: RemoteService<ReportsService>
  backup: Pick<RemoteService<BackupService>,
    'createBackup' | 'previewBackup' | 'restoreBackup' | 'configureSchedule' | 'getSchedule'
  >
  administration: {
    getAuditLogs(): Promise<Array<{
      action: string
      entity_type: string
      entity_id: string
      occurred_at: string
    }>>
  }
}

const RetailServicesContext =
  createContext<RetailApplicationServices | null>(null)

function createRemoteService<T extends object>(
  apiClient: ApiClient,
  domain: string,
): RemoteService<T> {
  const service = new Proxy({}, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined
      return (...args: unknown[]) => apiClient.request(
        `/api/v1/${domain}/${property}`,
        { method: 'POST', body: JSON.stringify({ args }) },
      )
    },
  })
  return service as RemoteService<T>
}

export function createOnlineApplicationServices(
  apiClient: ApiClient,
): RetailApplicationServices {
  const authentication: OnlineAuthentication = {
    needsInitialOwnerSetup: async () =>
      (await apiClient.setupStatus()).initialSetupRequired,
    restoreSession: async () => {
      const session = await apiClient.restoreSession()
      if (session) useSessionStore.getState().establishSession(session.user)
      return session?.user ?? null
    },
    setupInitialOwner: async (input) => {
      const session = await apiClient.setup(input)
      useSessionStore.getState().establishSession(session.user)
      return session.user
    },
    login: async (input) => {
      const session = await apiClient.login(input)
      useSessionStore.getState().establishSession(session.user)
      return session.user
    },
    updateOwnProfile: async (input) => {
      const session = await apiClient.updateOwnProfile(input)
      useSessionStore.getState().establishSession(session.user)
      return session.user
    },
    logout: async () => {
      await apiClient.logout()
      useSessionStore.getState().clearSession()
    },
  }

  return {
    apiClient,
    authentication,
    users: createRemoteService(apiClient, 'users'),
    roles: createRemoteService(apiClient, 'roles'),
    organization: createRemoteService(apiClient, 'organization'),
    businessConfiguration: createRemoteService(apiClient, 'businessConfiguration'),
    catalog: createRemoteService(apiClient, 'catalog'),
    inventory: createRemoteService(apiClient, 'inventory'),
    sales: createRemoteService(apiClient, 'sales'),
    purchases: createRemoteService(apiClient, 'purchases'),
    accounting: createRemoteService(apiClient, 'accounting'),
    manufacturing: createRemoteService(apiClient, 'manufacturing'),
    reports: createRemoteService(apiClient, 'reports'),
    backup: {
      createBackup: async (_actorId) =>
        apiClient.request<Uint8Array>(
          '/api/v1/admin/backups/export',
          { method: 'POST' },
          true,
          600_000,
        ),
      previewBackup: async (_actorId, bytes): Promise<BackupPreview> =>
        apiClient.uploadBytes('/api/v1/admin/backups/preview', bytes),
      restoreBackup: async (_actorId, bytes, confirmed): Promise<DatabaseHealth> => {
        const result = await apiClient.uploadBytes<DatabaseHealth>(
          '/api/v1/admin/backups/restore',
          bytes,
          { 'X-Safa-Restore-Confirmation': String(confirmed) },
        )
        apiClient.setAccessToken(null)
        useSessionStore.getState().clearSession()
        return result
      },
      configureSchedule: async (_actorId, input): Promise<BackupSchedule> =>
        apiClient.request('/api/v1/admin/backups/schedule', {
          method: 'PUT',
          body: JSON.stringify(input),
        }),
      getSchedule: async (_actorId): Promise<BackupSchedule> =>
        apiClient.request('/api/v1/admin/backups/schedule'),
    },
    administration: {
      getAuditLogs: () => apiClient.request('/api/v1/admin/audit-logs'),
    },
  }
}

export function RetailApplicationServicesProvider({
  services,
  children,
}: {
  services: RetailApplicationServices
  children: ReactNode
}) {
  return (
    <RetailServicesContext.Provider value={services}>
      {children}
    </RetailServicesContext.Provider>
  )
}

export function useRetailApplicationServices(): RetailApplicationServices {
  const services = useContext(RetailServicesContext)
  if (!services) {
    throw new Error('Online application services are not available')
  }
  return services
}
