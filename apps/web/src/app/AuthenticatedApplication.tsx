import { useEffect, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowDownRight, ArrowUpRight, Boxes, ChartNoAxesCombined, CircleDollarSign, ClipboardList, PackageSearch, ReceiptText, ShoppingCart, TrendingUp } from 'lucide-react'
import { useRetailApplicationServices } from './RetailApplicationServices'
import { useSessionStore } from '../features/auth/session-store'
import { LocalAuthenticationScreen } from '../features/auth/LocalAuthenticationScreen'
import {
  BranchesManagementScreen,
  BranchSelectionScreen,
  WarehouseSelectionScreen,
} from '../features/organization/LocationSelectionScreens'
import { PosScreen } from '../features/sales/PosScreen'
import {
  SaleDetailsScreen,
  SalesHistoryScreen,
  SalesReturnsScreen,
} from '../features/sales/SalesScreens'
import { ReportsDashboard } from '../features/reports/ReportsDashboard'
import { BackupManager } from '../features/backup/BackupManager'
import {
  CustomerStatementScreen,
  CustomersScreen,
  SupplierStatementScreen,
  SuppliersScreen,
} from '../features/accounting/PartyScreens'
import { CashboxesScreen, ExpensesScreen } from '../features/accounting/AccountingScreens'
import { ManufacturingDetailsScreen, ManufacturingOrdersScreen } from '../features/manufacturing/ManufacturingScreens'
import {
  ApplicationSettingsScreen,
  AuditLogsScreen,
  RolesScreen,
  UserAccountScreen,
  UsersScreen,
} from '../features/admin/AdministrationScreens'
import {
  PurchaseDetailsScreen,
  PurchasesScreen,
} from '../features/purchases/PurchaseScreens'
import {
  InventoryScreen,
  StocktakingScreen,
  StockTransfersScreen,
  WarehouseDetailsScreen,
} from '../features/inventory/InventoryScreens'
import {
  BarcodeManagementScreen,
  BrandsScreen,
  CategoriesScreen,
  ProductDetailsScreen,
  ProductsScreen,
} from '../features/catalog/ProductCatalogScreens'
import { NotFoundPage } from '../features/foundation/NotFoundPage'
import { Card } from '../shared/components/Card'
import { LanguageSwitcher } from '../shared/components/LanguageSwitcher'
import { AccountMenu } from '../features/auth/AccountMenu'
import { AccountProfileScreen } from '../features/auth/AccountProfileScreen'
import { useWorkspaceStore } from '../shared/state/workspace-store'
import { ToastError } from '../shared/components/ToastError'

export function AuthenticatedApplication({
  initialSetupRequired,
}: {
  initialSetupRequired: boolean
}) {
  const services = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const branchId = useWorkspaceStore((state) => state.branchId)
  const warehouseId = useWorkspaceStore((state) => state.warehouseId)
  const [setupRequired, setSetupRequired] = useState(initialSetupRequired)

  if (setupRequired) {
    return (
      <Routes>
        <Route
          path="/setup"
          element={
            <LocalAuthenticationScreen
              initialSetup
              onSetupComplete={() => setSetupRequired(false)}
            />
          }
        />
        <Route path="*" element={<Navigate replace to="/setup" />} />
      </Routes>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route
          path="/login"
          element={
            <LocalAuthenticationScreen
              initialSetup={false}
              onSetupComplete={() => {}}
            />
          }
        />
        <Route path="*" element={<Navigate replace to="/login" />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate replace to="/branch-selection" />} />
      <Route path="/branch-selection" element={<BranchSelectionScreen />} />
      <Route
        path="/warehouse-selection"
        element={branchId
          ? <WarehouseSelectionScreen />
          : <Navigate replace to="/branch-selection" />}
      />
      <Route element={<WorkspaceGuard branchId={branchId} warehouseId={warehouseId} />}>
        <Route element={<AuthenticatedLayout />}>
          <Route path="/branches" element={<BranchesManagementScreen />} />
        </Route>
      </Route>
      <Route element={<WorkspaceGuard branchId={branchId} warehouseId={warehouseId} />}>
        <Route element={<AuthenticatedLayout />}>
          <Route path="/" element={<Navigate replace to="/dashboard" />} />
          <Route path="/profile" element={<AccountProfileScreen user={user} />} />
          <Route path="/dashboard" element={<DashboardScreen />} />
          {user.permissions.includes('products.read') && (
            <>
              <Route path="/products" element={<ProductsScreen />} />
              <Route path="/products/:productId" element={<ProductDetailsScreen />} />
              <Route path="/categories" element={<CategoriesScreen />} />
              <Route path="/brands" element={<BrandsScreen />} />
              <Route path="/barcodes" element={<BarcodeManagementScreen />} />
            </>
          )}
          {user.permissions.includes('customers.manage') && (
            <Route path="/customers" element={<CustomersScreen />} />
          )}
          {user.permissions.includes('accounting.read') && (
            <>
              <Route path="/customers/:customerId/statement" element={<CustomerStatementScreen />} />
              <Route path="/expenses" element={<ExpensesScreen />} />
              <Route path="/cashboxes" element={<CashboxesScreen />} />
            </>
          )}
          {user.permissions.includes('suppliers.manage') && (
            <Route path="/suppliers" element={<SuppliersScreen />} />
          )}
          {user.permissions.includes('purchases.read') && (
            <>
              <Route path="/purchases/:purchaseId" element={<PurchaseDetailsScreen />} />
              <Route
                path="/suppliers/:supplierId/statement"
                element={<SupplierStatementScreen />}
              />
            </>
          )}
          {(user.permissions.includes('purchases.read') ||
            user.permissions.includes('purchases.create')) && (
            <Route path="/purchases" element={<PurchasesScreen />} />
          )}
          {user.permissions.includes('inventory.read') && (
            <>
              <Route path="/inventory" element={<InventoryScreen />} />
              <Route path="/warehouse-details" element={<WarehouseDetailsScreen />} />
            </>
          )}
          {user.permissions.includes('inventory.count') && (
            <>
              <Route path="/inventory/counts" element={<StocktakingScreen />} />
              <Route path="/inventory/counts/:countId" element={<StocktakingScreen />} />
            </>
          )}
          {user.permissions.includes('inventory.transfer') && (
            <>
              <Route path="/inventory/transfers" element={<StockTransfersScreen />} />
              <Route path="/inventory/transfers/:transferId" element={<StockTransfersScreen />} />
            </>
          )}
          {user.permissions.includes('manufacturing.manage') && (
            <>
              <Route path="/manufacturing" element={<ManufacturingOrdersScreen />} />
              <Route path="/manufacturing/:orderId" element={<ManufacturingDetailsScreen />} />
            </>
          )}
          {user.permissions.includes('sales.create') && (
            <Route
              path="/pos"
              element={
                <PosScreen
                  actorId={user.id}
                  branchId={branchId ?? ''}
                  warehouseId={warehouseId ?? ''}
                  salesService={services.sales}
                />
              }
            />
          )}
          {user.permissions.includes('sales.read') && (
            <>
              <Route path="/sales" element={<SalesHistoryScreen />} />
              <Route path="/sales/:saleId" element={<SaleDetailsScreen />} />
            </>
          )}
          {user.permissions.includes('sales.returns') &&
            user.permissions.includes('sales.read') && (
              <Route path="/sales/returns" element={<SalesReturnsScreen />} />
            )}
          {user.permissions.includes('reports.read') && (
            <Route
              path="/reports"
              element={
                <ReportsDashboard
                  actorId={user.id}
                  reportsService={services.reports}
                />
              }
            />
          )}
          {user.permissions.includes('settings.manage') && (
            <>
              <Route path="/settings" element={<ApplicationSettingsScreen />} />
              <Route path="/audit-logs" element={<AuditLogsScreen />} />
              <Route path="/settings/backup" element={<BackupManager actorId={user.id} backupService={services.backup} />} />
            </>
          )}
          {user.permissions.includes('users.manage') && <Route path="/users" element={<UsersScreen />} />}
          {user.permissions.includes('users.manage') && <Route path="/users/:userId" element={<UserAccountScreen />} />}
          {user.permissions.includes('roles.manage') && <Route path="/roles" element={<RolesScreen />} />}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}

function WorkspaceGuard({
  branchId,
  warehouseId,
}: {
  branchId: string | null
  warehouseId: string | null
}) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { organization } = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const clearWorkspace = useWorkspaceStore((state) => state.clearWorkspace)
  const clearWarehouse = useWorkspaceStore((state) => state.clearWarehouse)
  const [validation, setValidation] = useState<{
    key: string
    status: 'checking' | 'valid' | 'error'
    message?: string
  } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const key = `${pathname}:${branchId ?? ''}:${warehouseId ?? ''}`

  useEffect(() => {
    if (!user || !branchId || !warehouseId) return
    let active = true
    void (async () => {
      try {
        const branches = await organization.listAccessibleBranches(user.id)
        if (!active) return
        if (!branches.some((branch) => branch.id === branchId)) {
          clearWorkspace()
          return
        }
        const warehouses = await organization.listAccessibleWarehouses(
          user.id,
          branchId,
        )
        if (!active) return
        if (!warehouses.some((warehouse) =>
          warehouse.id === warehouseId &&
          warehouse.branchId === branchId &&
          warehouse.status === 'active',
        )) {
          clearWarehouse()
          return
        }
        if (active) setValidation({ key, status: 'valid' })
      } catch (error) {
        if (active) {
          setValidation({
            key,
            status: 'error',
            message: error instanceof Error ? error.message : 'Workspace validation failed',
          })
        }
      }
    })()
    return () => { active = false }
  }, [
    attempt,
    branchId,
    clearWarehouse,
    clearWorkspace,
    key,
    organization,
    user,
    warehouseId,
  ])

  if (!branchId) return <Navigate replace to="/branch-selection" />
  if (!warehouseId) return <Navigate replace to="/warehouse-selection" />
  if (!user) return <Navigate replace to="/login" />
  if (validation?.key !== key || validation.status === 'checking') {
    return <main className="p-6 text-center text-sm text-[var(--muted)]" role="status">
      {t('locations.validating')}
    </main>
  }
  if (validation.status === 'error') {
    return (
      <main className="mx-auto max-w-xl space-y-3 p-6">
        <ToastError error={validation.message ?? ''} />
        <p className="rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">
          {validation.message}
        </p>
        <button
          className="min-h-11 rounded-xl bg-[var(--brand)] px-4 font-bold text-white"
          onClick={() => {
            setValidation(null)
            setAttempt((value) => value + 1)
          }}
          type="button"
        >
          {t('common.retry')}
        </button>
      </main>
    )
  }
  if (validation.status !== 'valid') return null
  return <Outlet />
}

function AuthenticatedLayout() {
  const { t, i18n } = useTranslation()
  const { authentication, organization } = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const clearWorkspace = useWorkspaceStore((state) => state.clearWorkspace)
  const { branchId, warehouseId } = useWorkspaceStore()
  const [logoutError, setLogoutError] = useState('')
  const [workspaceLabel, setWorkspaceLabel] = useState('')
  const [workspaceError, setWorkspaceError] = useState('')
  useEffect(() => {
    let active = true
    const loadLabel = async (): Promise<void> => {
      if (!user || !branchId) {
        setWorkspaceLabel('')
        setWorkspaceError('')
        return
      }
      try {
        const [branches, warehouses] = await Promise.all([
          organization.listAccessibleBranches(user.id),
          organization.listAccessibleWarehouses(user.id, branchId),
        ])
        if (!active) return
        const branchName = branches.find((branch) => branch.id === branchId)?.name
        const warehouseName = warehouses.find((warehouse) => warehouse.id === warehouseId)?.name
        setWorkspaceLabel([branchName, warehouseName].filter(Boolean).join(' · '))
        setWorkspaceError('')
      } catch (error) {
        if (active) {
          setWorkspaceError(error instanceof Error ? error.message : t('locations.loadFailed'))
        }
      }
    }
    void loadLabel()
    return () => { active = false }
  }, [branchId, organization, t, user, warehouseId])
  if (!user) return <Navigate replace to="/login" />

  const navigation = [
    { path: '/dashboard', label: t('navigation.dashboard'), permission: null },
    { path: '/branches', label: t('navigation.branches'), permission: null },
    { path: '/products', label: t('navigation.products'), permission: 'products.read' },
    { path: '/pos', label: t('navigation.pos'), permission: 'sales.create' },
    { path: '/sales', label: t('navigation.salesHistory'), permission: 'sales.read' },
    { path: '/customers', label: t('navigation.customers'), permission: 'customers.manage' },
    { path: '/expenses', label: t('navigation.expenses'), permission: 'accounting.read' },
    { path: '/cashboxes', label: t('navigation.cashboxes'), permission: 'accounting.read' },
    { path: '/suppliers', label: t('navigation.suppliers'), permission: 'suppliers.manage' },
    { path: '/purchases', label: t('navigation.purchases'), permission: 'purchases.read' },
    { path: '/inventory', label: t('navigation.inventory'), permission: 'inventory.read' },
    { path: '/inventory/transfers', label: t('navigation.transfers'), permission: 'inventory.transfer' },
    { path: '/manufacturing', label: t('navigation.manufacturing'), permission: 'manufacturing.manage' },
    { path: '/users', label: t('navigation.users'), permission: 'users.manage' },
    { path: '/roles', label: t('navigation.roles'), permission: 'roles.manage' },
    { path: '/settings', label: t('navigation.settings'), permission: 'settings.manage' },
    { path: '/audit-logs', label: t('navigation.audit'), permission: 'settings.manage' },
    { path: '/reports', label: t('navigation.reports'), permission: 'reports.read' },
    { path: '/settings/backup', label: t('navigation.backup'), permission: 'settings.manage' },
  ].filter((item) =>
    item.permission === null ||
    user.permissions.includes(item.permission) ||
    (item.path === '/purchases' && user.permissions.includes('purchases.create')),
  )

  const logout = async (): Promise<void> => {
    setLogoutError('')
    clearWorkspace()
    try {
      await authentication.logout()
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : t('auth.logoutFailed'))
    }
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-[var(--surface)]">
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-white/95 shadow-[0_8px_24px_-22px_rgba(16,44,33,0.55)] backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
          <div className="flex min-h-[4.25rem] items-center justify-between gap-3 py-2">
            <Link className="group flex min-w-0 items-center gap-2.5 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] sm:gap-3" to="/dashboard">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[var(--brand)] to-[var(--brand-strong)] text-lg font-black text-white shadow-[var(--shadow-brand)] transition-transform group-hover:scale-105 sm:size-11">
                {i18n.resolvedLanguage === 'ar' ? 'س' : 'S'}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-black tracking-tight text-[var(--ink)] sm:text-base">
                  {t('app.name')}
                </span>
                <span className="hidden text-[10px] font-semibold tracking-wide text-[var(--muted)] sm:block">
                  {t('navigation.headerSubtitle')}
                </span>
              </span>
            </Link>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {workspaceLabel && (
              <span className="hidden max-w-56 truncate rounded-xl bg-[var(--brand-wash)] px-3 py-2 text-xs font-bold text-[var(--brand)] md:block">
                {workspaceLabel}
              </span>
            )}
            <LanguageSwitcher />
              <AccountMenu
                onLogout={logout}
                user={user}
              />
            </div>
          </div>
          <nav
            aria-label={t('navigation.primary')}
            className="-mx-3 flex gap-1 overflow-x-auto border-t border-[var(--border)] px-3 py-2 [scrollbar-width:none] sm:-mx-6 sm:gap-1.5 sm:px-6 lg:-mx-8 lg:px-8 [&::-webkit-scrollbar]:hidden"
          >
            {navigation.map((item) => (
              <NavLink
                className={({ isActive }) =>
                  `min-h-10 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-bold transition-colors sm:text-sm ${
                    isActive
                      ? 'bg-[var(--brand-wash)] text-[var(--brand)]'
                      : 'text-[var(--muted)] hover:bg-[var(--surface)]'
                  }`
                }
                key={item.path}
                to={item.path}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      {(logoutError || workspaceError) && <><ToastError error={logoutError || workspaceError} /><p className="mx-auto mt-3 max-w-7xl rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{logoutError || workspaceError}</p></>}
      <Outlet />
    </div>
  )
}

function DashboardScreen() {
  const { t, i18n } = useTranslation()
  const user = useSessionStore((state) => state.user)
  const { branchId, warehouseId, clearWorkspace } = useWorkspaceStore()
  const { organization, reports } = useRetailApplicationServices()
  const [dashboardDate] = useState(() => new Date())
  const [location, setLocation] = useState({
    branchName: '',
    warehouseName: '',
  })
  const [summaryState, setSummaryState] = useState<{
    actorId: string
    branchId: string | null
    value: Record<string, string>
  } | null>(null)
  const [summaryErrorState, setSummaryErrorState] = useState<{
    actorId: string
    branchId: string | null
    message: string
  } | null>(null)

  useEffect(() => {
    let active = true
    if (!user?.permissions.includes('reports.read')) {
      return () => { active = false }
    }

    const now = new Date()
    const toDate = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-')
    const fromDate = `${toDate.slice(0, 7)}-01`
    void reports.getReports(user.id, {
      fromDate,
      toDate,
      ...(branchId ? { branchId } : {}),
    }).then((result) => {
      if (active) setSummaryState({ actorId: user.id, branchId, value: result.summary })
    }).catch((loadError: unknown) => {
      if (active) {
        setSummaryErrorState({
          actorId: user.id,
          branchId,
          message: loadError instanceof Error ? loadError.message : t('dashboard.metricsFailed'),
        })
      }
    })
    return () => { active = false }
  }, [branchId, reports, t, user])
  const summary = summaryState &&
    summaryState.actorId === user?.id &&
    summaryState.branchId === branchId
    ? summaryState.value
    : null
  const summaryError = summaryErrorState &&
    summaryErrorState.actorId === user?.id &&
    summaryErrorState.branchId === branchId
    ? summaryErrorState.message
    : ''
  const summaryLoading = Boolean(user?.permissions.includes('reports.read')) &&
    !summary && !summaryError

  useEffect(() => {
    let active = true
    if (!user || !branchId || !warehouseId) return
    void Promise.all([
      organization.listAccessibleBranches(user.id),
      organization.listAccessibleWarehouses(user.id, branchId),
    ]).then(([branches, warehouses]) => {
      if (!active) return
      const branch = branches.find((item) => item.id === branchId)
      const warehouse = warehouses.find((item) => item.id === warehouseId)
      if (!branch || !warehouse) {
        clearWorkspace()
        return
      }
      setLocation({ branchName: branch.name, warehouseName: warehouse.name })
    }).catch((error: unknown) => {
      if (active) {
        setLocation({
          branchName: error instanceof Error ? error.message : t('locations.loadFailed'),
          warehouseName: '',
        })
      }
    })
    return () => {
      active = false
    }
  }, [branchId, clearWorkspace, organization, t, user, warehouseId])

  const metricCards = [
    { key: 'netSales', label: t('dashboard.netSales'), icon: TrendingUp, tone: 'text-emerald-700 bg-emerald-50' },
    { key: 'salesInvoiceCount', label: t('dashboard.salesInvoices'), icon: ReceiptText, tone: 'text-blue-700 bg-blue-50', count: true },
    { key: 'netPurchases', label: t('dashboard.netPurchases'), icon: ShoppingCart, tone: 'text-violet-700 bg-violet-50' },
    { key: 'netProfit', label: t('dashboard.netProfit'), icon: CircleDollarSign, tone: 'text-amber-700 bg-amber-50' },
    { key: 'inventoryValueCurrent', label: t('dashboard.inventoryValue'), icon: Boxes, tone: 'text-cyan-700 bg-cyan-50' },
    { key: 'lowStockProductCount', label: t('dashboard.lowStock'), icon: PackageSearch, tone: 'text-rose-700 bg-rose-50', count: true },
  ]

  return (
    <main className="mx-auto max-w-7xl space-y-7 px-4 py-6 sm:px-8">
      <header className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#0b3f31] via-[#126448] to-[#18805b] p-6 text-white shadow-[0_24px_70px_-30px_rgba(11,63,49,0.65)] sm:p-9">
        <div aria-hidden="true" className="pointer-events-none absolute -end-10 -top-20 size-72 rounded-full border-[40px] border-white/5" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 end-40 size-64 rounded-full bg-white/5 blur-2xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-emerald-100">
              <ChartNoAxesCombined aria-hidden="true" size={17} />
              {t('dashboard.eyebrow')}
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
              {t('dashboard.welcome', { name: user?.displayName ?? '' })}
            </h1>
            {branchId && warehouseId ? (
              <p className="mt-3 text-sm text-emerald-100">{t('dashboard.location', location)}</p>
            ) : (
              <Link className="mt-3 inline-flex min-h-10 items-center rounded-xl text-sm font-bold text-white underline decoration-white/40 underline-offset-4 hover:decoration-white" to="/branch-selection">
                {t('dashboard.selectLocation')}
              </Link>
            )}
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
            <p className="text-xs font-semibold text-emerald-100">{t('dashboard.period')}</p>
            <p className="mt-1 font-bold">{new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(dashboardDate)}</p>
          </div>
        </div>
      </header>

      {user?.permissions.includes('reports.read') && (
        <section aria-label={t('dashboard.keyNumbers')}>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[var(--brand)]">{t('dashboard.performance')}</p>
              <h2 className="mt-1 text-xl font-black text-[var(--ink)]">{t('dashboard.keyNumbers')}</h2>
            </div>
            <Link className="inline-flex items-center gap-1 text-sm font-bold text-[var(--brand)] hover:underline" to="/reports">
              {t('dashboard.viewReports')} <ArrowUpRight aria-hidden="true" size={16} />
            </Link>
          </div>
          {summaryError && <><ToastError error={summaryError} /><p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{summaryError}</p></>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {metricCards.map(({ key, label, icon: Icon, tone, count }) => (
              <Card className="group relative overflow-hidden p-5 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]" key={key}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--muted)]">{label}</p>
                    <p aria-live="polite" className={`mt-3 text-2xl font-black tracking-tight text-[var(--ink)] sm:text-3xl ${summaryLoading ? 'animate-pulse' : ''}`}>
                      {summaryLoading ? '—' : summary?.[key] === undefined ? '—' : count
                        ? Number(summary[key]).toLocaleString()
                        : Number(summary[key]).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="mt-2 text-xs text-[var(--muted)]">{t('dashboard.currentMonth')}</p>
                  </div>
                  <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${tone}`}>
                    <Icon aria-hidden="true" size={21} />
                  </span>
                </div>
                {key === 'netProfit' && summary?.netProfit && (
                  Number(summary.netProfit) >= 0
                    ? <ArrowUpRight aria-hidden="true" className="absolute -bottom-3 -end-3 size-16 text-emerald-500/10" />
                    : <ArrowDownRight aria-hidden="true" className="absolute -bottom-3 -end-3 size-16 text-rose-500/10" />
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-4 flex items-center gap-2">
          <ClipboardList aria-hidden="true" className="text-[var(--brand)]" size={19} />
          <h2 className="text-xl font-black text-[var(--ink)]">{t('dashboard.quickAccess')}</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {user?.permissions.includes('products.read') && (
          <DashboardCard
            title={t('dashboard.productsTitle')}
            description={t('dashboard.productsDescription')}
            href="/products"
          />
        )}
        {user?.permissions.includes('sales.create') && (
          <DashboardCard
            title={t('dashboard.posTitle')}
            description={t('dashboard.posDescription')}
            href="/pos"
          />
        )}
        {user?.permissions.includes('sales.read') && (
          <DashboardCard
            title={t('dashboard.salesHistoryTitle')}
            description={t('dashboard.salesHistoryDescription')}
            href="/sales"
          />
        )}
        {user?.permissions.includes('customers.manage') && (
          <DashboardCard
            title={t('dashboard.customersTitle')}
            description={t('dashboard.customersDescription')}
            href="/customers"
          />
        )}
        {user?.permissions.includes('suppliers.manage') && (
          <DashboardCard
            title={t('dashboard.suppliersTitle')}
            description={t('dashboard.suppliersDescription')}
            href="/suppliers"
          />
        )}
        {user?.permissions.includes('purchases.read') && (
          <DashboardCard
            title={t('dashboard.purchasesTitle')}
            description={t('dashboard.purchasesDescription')}
            href="/purchases"
          />
        )}
        {user?.permissions.includes('inventory.read') && (
          <DashboardCard
            title={t('dashboard.inventoryTitle')}
            description={t('dashboard.inventoryDescription')}
            href="/inventory"
          />
        )}
        {user?.permissions.includes('reports.read') && (
          <DashboardCard
            title={t('dashboard.reportsTitle')}
            description={t('dashboard.reportsDescription')}
            href="/reports"
          />
        )}
        {user?.permissions.includes('settings.manage') && (
          <DashboardCard
            title={t('dashboard.backupTitle')}
            description={t('dashboard.backupDescription')}
            href="/settings/backup"
          />
        )}
        </div>
      </section>
    </main>
  )
}

function DashboardCard({
  title,
  description,
  href,
}: {
  title: string
  description: string
  href: string
}) {
  return (
    <Link className="block" to={href}>
      <Card className="h-full p-5 transition hover:border-[var(--brand-border)]">
        <h2 className="font-extrabold text-[var(--ink)]">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{description}</p>
      </Card>
    </Link>
  )
}
