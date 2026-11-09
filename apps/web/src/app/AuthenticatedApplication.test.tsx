import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RetailApplicationServices } from './RetailApplicationServices'
import { RetailApplicationServicesProvider } from './RetailApplicationServices'
import { AuthenticatedApplication } from './AuthenticatedApplication'
import { useSessionStore } from '../features/auth/session-store'
import type { AuthenticatedUser } from '../features/auth/auth.types'
import type { Branch, Warehouse } from '../features/organization/OrganizationService'
import { useWorkspaceStore } from '../shared/state/workspace-store'
import i18n from '../shared/i18n'

const user: AuthenticatedUser = {
  id: 'user-id',
  username: 'operator',
  displayName: 'Operator',
  roleCodes: ['branch_manager'],
  permissions: [],
  branchIds: ['branch-1'],
  warehouseIds: ['warehouse-1'],
}

const adminUser: AuthenticatedUser = {
  ...user,
  roleCodes: ['system_owner'],
}

const branch: Branch = {
  id: 'branch-1',
  code: 'NORTH',
  name: 'North Branch',
  address: null,
  phone: null,
  status: 'active',
  createdAt: '2026-11-08T00:00:00.000Z',
  updatedAt: '2026-11-08T00:00:00.000Z',
}

const warehouse: Warehouse = {
  id: 'warehouse-1',
  branchId: branch.id,
  code: 'MAIN',
  name: 'Main Warehouse',
  warehouseType: 'fabrics',
  address: null,
  description: null,
  status: 'active',
  createdAt: '2026-11-08T00:00:00.000Z',
  updatedAt: '2026-11-08T00:00:00.000Z',
}

function createServices(
  branches: Branch[] = [branch],
  warehouses: Warehouse[] = [warehouse],
) {
  const organization = {
    listAccessibleBranches: vi.fn(async () => branches),
    listAccessibleWarehouses: vi.fn(async (_actorId: string, branchId: string) =>
      warehouses.filter((item) => item.branchId === branchId),
    ),
  }
  const authentication = {
    login: vi.fn(async () => {
      useSessionStore.getState().establishSession(user)
      return user
    }),
    logout: vi.fn(async () => {
      useSessionStore.getState().clearSession()
    }),
  }
  return {
    services: {
      organization,
      authentication,
      catalog: {
        listUnits: vi.fn(async () => []),
        initializeStandardUnits: vi.fn(async () => {}),
        listProducts: vi.fn(async () => []),
        listCategories: vi.fn(async () => []),
        listBrands: vi.fn(async () => []),
      },
      manufacturing: {
        listOrders: vi.fn(async () => []),
      },
    } as unknown as RetailApplicationServices,
    organization,
    authentication,
  }
}

function renderApplication(
  services: RetailApplicationServices,
  initialPath: string,
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <RetailApplicationServicesProvider services={services}>
        <AuthenticatedApplication initialSetupRequired={false} />
      </RetailApplicationServicesProvider>
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  useSessionStore.getState().clearSession()
  useWorkspaceStore.getState().clearWorkspace()
})

afterEach(() => {
  cleanup()
  useSessionStore.getState().clearSession()
  useWorkspaceStore.getState().clearWorkspace()
  vi.restoreAllMocks()
})

describe('authenticated workspace navigation', () => {
  it('sends login to branch selection without auto-selecting a single branch', async () => {
    const { services, organization } = createServices()
    renderApplication(services, '/login')
    const actor = userEvent.setup()

    await actor.type(screen.getByLabelText('Username'), 'operator')
    await actor.type(screen.getByLabelText('Password'), 'a-valid-password')
    await actor.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('button', { name: /North Branch/ }))
      .toBeInTheDocument()
    expect(organization.listAccessibleWarehouses).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState()).toMatchObject({
      branchId: null,
      warehouseId: null,
    })
  })

  it('requires branch and warehouse choices and lists only warehouses for that branch', async () => {
    const secondBranch = { ...branch, id: 'branch-2', code: 'SOUTH', name: 'South Branch' }
    const secondWarehouse = { ...warehouse, id: 'warehouse-2', branchId: secondBranch.id, name: 'South Warehouse' }
    const { services, organization } = createServices(
      [branch],
      [warehouse, secondWarehouse],
    )
    useSessionStore.getState().establishSession(user)
    renderApplication(services, '/branch-selection')
    const actor = userEvent.setup()

    await actor.click(await screen.findByRole('button', { name: /North Branch/ }))
    expect(await screen.findByRole('button', { name: /Main Warehouse/ }))
      .toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /South Warehouse/ }))
      .not.toBeInTheDocument()
    expect(organization.listAccessibleWarehouses).toHaveBeenCalledWith(
      user.id,
      branch.id,
    )
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: /Main Warehouse/ }))
    expect(await screen.findByRole('link', { name: 'Dashboard' }))
      .toBeInTheDocument()
    expect(useWorkspaceStore.getState()).toMatchObject({
      branchId: branch.id,
      warehouseId: warehouse.id,
    })
    expect(sessionStorage.getItem('safa.branchId')).toBe(branch.id)
    expect(sessionStorage.getItem('safa.warehouseId')).toBe(warehouse.id)
  })

  it('blocks direct dashboard access until a branch and warehouse are selected', async () => {
    const { services } = createServices()
    useSessionStore.getState().establishSession(user)
    renderApplication(services, '/dashboard')

    expect(await screen.findByRole('heading', { name: 'Select a branch' }))
      .toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
  })

  it('clears a no-longer-authorized branch and warehouse from a restored session', async () => {
    const { services } = createServices([], [])
    useSessionStore.getState().establishSession(user)
    useWorkspaceStore.getState().setBranch(branch.id)
    useWorkspaceStore.getState().setWarehouse(warehouse.id)
    renderApplication(services, '/dashboard')

    expect(await screen.findByRole('heading', { name: 'Select a branch' }))
      .toBeInTheDocument()
    await waitFor(() => {
      expect(useWorkspaceStore.getState()).toMatchObject({
        branchId: null,
        warehouseId: null,
      })
    })
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
  })

  it('validates restored selections and clears an inactive warehouse selection', async () => {
    const inactiveWarehouse = { ...warehouse, status: 'inactive' as const }
    const { services } = createServices([branch], [inactiveWarehouse])
    useSessionStore.getState().establishSession(user)
    useWorkspaceStore.getState().setBranch(branch.id)
    useWorkspaceStore.getState().setWarehouse(warehouse.id)
    renderApplication(services, '/dashboard')

    expect(await screen.findByRole('heading', { name: 'Select a warehouse' }))
      .toBeInTheDocument()
    expect(useWorkspaceStore.getState()).toMatchObject({
      branchId: branch.id,
      warehouseId: null,
    })
  })

  it('restores valid workspace selections and clears them on logout', async () => {
    const { services, organization, authentication } = createServices()
    useSessionStore.getState().establishSession(user)
    useWorkspaceStore.getState().setBranch(branch.id)
    useWorkspaceStore.getState().setWarehouse(warehouse.id)
    renderApplication(services, '/dashboard')

    expect(await screen.findByRole('link', { name: 'Dashboard' }))
      .toBeInTheDocument()
    expect(organization.listAccessibleBranches).toHaveBeenCalledWith(user.id)
    expect(organization.listAccessibleWarehouses).toHaveBeenCalledWith(
      user.id,
      branch.id,
    )

    const actor = userEvent.setup()
    await actor.click(screen.getByRole('button', { name: /Operator/ }))
    await actor.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    await waitFor(() => expect(authentication.logout).toHaveBeenCalled())
    await waitFor(() => {
      expect(useWorkspaceStore.getState()).toMatchObject({
        branchId: null,
        warehouseId: null,
      })
    })
  })

  it('lets admins change branch and then select a warehouse from the account menu', async () => {
    const { services } = createServices()
    useSessionStore.getState().establishSession(adminUser)
    useWorkspaceStore.getState().setBranch(branch.id)
    useWorkspaceStore.getState().setWarehouse(warehouse.id)
    renderApplication(services, '/dashboard')
    const actor = userEvent.setup()

    await screen.findByRole('link', { name: 'Dashboard' })
    await actor.click(screen.getByRole('button', { name: /Operator/ }))
    await actor.click(screen.getByRole('menuitem', { name: 'Change location' }))

    expect(await screen.findByRole('heading', { name: 'Select a branch' }))
      .toBeInTheDocument()
    expect(useWorkspaceStore.getState()).toMatchObject({
      branchId: null,
      warehouseId: null,
    })

    await actor.click(await screen.findByRole('button', { name: /North Branch/ }))
    expect(await screen.findByRole('heading', { name: 'Select a warehouse' }))
      .toBeInTheDocument()
    await actor.click(await screen.findByRole('button', { name: /Main Warehouse/ }))
    expect(await screen.findByRole('link', { name: 'Dashboard' }))
      .toBeInTheDocument()
    expect(useWorkspaceStore.getState()).toMatchObject({
      branchId: branch.id,
      warehouseId: warehouse.id,
    })
  })

  it('keeps assigned users in their selected location and hides admin location controls', async () => {
    const { services } = createServices()
    useSessionStore.getState().establishSession(user)
    useWorkspaceStore.getState().setBranch(branch.id)
    useWorkspaceStore.getState().setWarehouse(warehouse.id)
    renderApplication(services, '/branch-selection')
    const actor = userEvent.setup()

    expect(await screen.findByRole('link', { name: 'Dashboard' }))
      .toBeInTheDocument()
    expect(useWorkspaceStore.getState()).toMatchObject({
      branchId: branch.id,
      warehouseId: warehouse.id,
    })
    expect(screen.queryByRole('link', { name: 'Branches' })).not.toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: /Operator/ }))
    expect(screen.queryByRole('menuitem', { name: 'Change location' }))
      .not.toBeInTheDocument()
  })

  it('only exposes manufacturing to users in clothing warehouses', async () => {
    const manufacturingUser = {
      ...user,
      permissions: ['manufacturing.manage'],
    }
    const fabricWarehouse = { ...warehouse, warehouseType: 'fabrics' as const }
    const { services } = createServices([branch], [fabricWarehouse])
    useSessionStore.getState().establishSession(manufacturingUser)
    useWorkspaceStore.getState().setBranch(branch.id)
    useWorkspaceStore.getState().setWarehouse(fabricWarehouse.id)
    renderApplication(services, '/manufacturing')

    await screen.findByRole('link', { name: 'Dashboard' })
    expect(screen.queryByRole('link', { name: 'Manufacturing' }))
      .not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Manufacturing orders' }))
      .not.toBeInTheDocument()
  })

  it('shows manufacturing for assigned clothing warehouses', async () => {
    const manufacturingUser = {
      ...user,
      permissions: ['manufacturing.manage'],
    }
    const clothingWarehouse = {
      ...warehouse,
      warehouseType: 'clothing_manufacturing' as const,
    }
    const { services } = createServices([branch], [clothingWarehouse])
    useSessionStore.getState().establishSession(manufacturingUser)
    useWorkspaceStore.getState().setBranch(branch.id)
    useWorkspaceStore.getState().setWarehouse(clothingWarehouse.id)
    renderApplication(services, '/manufacturing')

    expect(await screen.findByRole('heading', { name: 'Manufacturing orders' }))
      .toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manufacturing' }))
      .toBeInTheDocument()
  })

  it('redirects assigned users away from branch management when opening its URL directly', async () => {
    const { services } = createServices()
    useSessionStore.getState().establishSession(user)
    useWorkspaceStore.getState().setBranch(branch.id)
    useWorkspaceStore.getState().setWarehouse(warehouse.id)
    renderApplication(services, '/branches')

    expect(await screen.findByRole('heading', { name: 'Welcome, Operator' }))
      .toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Branches and warehouses' }))
      .not.toBeInTheDocument()
  })

  it('keeps protected navigation responsive without revalidating the workspace', async () => {
    const productUser = { ...user, permissions: ['products.read'] }
    const { services, organization } = createServices()
    useSessionStore.getState().establishSession(productUser)
    useWorkspaceStore.getState().setBranch(branch.id)
    useWorkspaceStore.getState().setWarehouse(warehouse.id)
    renderApplication(services, '/dashboard')

    await screen.findByRole('link', { name: 'Products' })
    await waitFor(() => {
      expect(organization.listAccessibleBranches).toHaveBeenCalledTimes(3)
      expect(organization.listAccessibleWarehouses).toHaveBeenCalledTimes(3)
    })

    await userEvent.setup().click(screen.getByRole('link', { name: 'Products' }))

    expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument()
    expect(screen.queryByText('Validating your branch and warehouse access...'))
      .not.toBeInTheDocument()
    expect(organization.listAccessibleBranches).toHaveBeenCalledTimes(3)
    expect(organization.listAccessibleWarehouses).toHaveBeenCalledTimes(3)
  })
})
