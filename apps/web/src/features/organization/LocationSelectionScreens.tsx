import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import {
  Archive,
  ArrowRight,
  Building2,
  Check,
  MapPin,
  Pencil,
  Plus,
  Warehouse as WarehouseIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useRetailApplicationServices } from '../../app/RetailApplicationServices'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { useConfirmDialog } from '../../shared/components/ConfirmDialog'
import { ToastError } from '../../shared/components/ToastError'
import { LanguageSwitcher } from '../../shared/components/LanguageSwitcher'
import { useSessionStore } from '../auth/session-store'
import { useWorkspaceStore } from '../../shared/state/workspace-store'
import type { Branch, Warehouse } from './OrganizationService'

export function BranchSelectionScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { organization } = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const setBranch = useWorkspaceStore((state) => state.setBranch)
  const clearWorkspace = useWorkspaceStore((state) => state.clearWorkspace)
  const [branches, setBranches] = useState<Branch[]>([])
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canManage = Boolean(user?.permissions.includes('settings.manage'))
  const canCreateBranch = Boolean(
    canManage &&
    user?.roleCodes.some((role) =>
      ['system_owner', 'general_manager', 'admin'].includes(role),
    ),
  )

  useEffect(() => {
    let active = true
    clearWorkspace()
    if (!user) return
    void organization.listAccessibleBranches(user.id).then((availableBranches) => {
      if (active) {
        setBranches(availableBranches)
      }
    }).catch((loadError: unknown) => {
      if (active) {
        setError(loadError instanceof Error ? loadError.message : t('locations.loadFailed'))
      }
    })
    return () => {
      active = false
    }
  }, [clearWorkspace, organization, t, user])

  const select = (branch: Branch): void => {
    setBranch(branch.id)
    navigate('/warehouse-selection')
  }

  const create = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !canCreateBranch) return
    setBusy(true)
    setError('')
    try {
      await organization.createBranch(user.id, { code, name })
      setBranches(await organization.listAccessibleBranches(user.id))
      setCode('')
      setName('')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('locations.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <LocationSelectionLayout
      title={t('locations.branchTitle')}
      description={t('locations.branchDescription')}
      icon={<MapPin aria-hidden="true" size={22} />}
      error={error}
    >
      {branches.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {branches.map((branch) => (
            <li key={branch.id}>
              <button
                className="group flex min-h-28 w-full items-center gap-4 rounded-2xl border border-[var(--border)] bg-white p-4 text-start shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-[var(--brand-border)] hover:shadow-[var(--shadow-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] sm:p-5"
                onClick={() => select(branch)}
                type="button"
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--brand-wash)] text-[var(--brand)] transition-colors group-hover:bg-[var(--brand)] group-hover:text-white">
                  <Building2 aria-hidden="true" size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-extrabold text-[var(--ink)]">{branch.name}</span>
                  <span className="mt-2 inline-flex max-w-full items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-bold tracking-wide text-[var(--muted)]">
                    <span className="truncate">{branch.code}</span>
                  </span>
                </span>
                <span className="grid size-9 shrink-0 place-items-center rounded-xl text-[var(--brand)] transition group-hover:bg-[var(--brand-wash)]">
                  <ArrowRight aria-hidden="true" className="rtl:rotate-180" size={19} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {branches.length === 0 && !canCreateBranch && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          {t('locations.noBranches')}
        </p>
      )}
      {canCreateBranch && (
        <Card as="article" className="overflow-hidden border-[var(--brand-border)]">
          <form className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5" onSubmit={(event) => void create(event)}>
            <div className="flex items-center gap-3 sm:col-span-2">
              <span className="grid size-10 place-items-center rounded-xl bg-[var(--brand-wash)] text-[var(--brand)]">
                <Plus aria-hidden="true" size={19} />
              </span>
              <h2 className="font-extrabold text-[var(--ink)]">{t('locations.addBranch')}</h2>
            </div>
            <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]">
              {t('locations.code')}
              <input
                className="min-h-11 rounded-xl border border-[var(--border)] bg-white px-3 outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-wash)]"
                maxLength={32}
                minLength={2}
                onChange={(event) => setCode(event.target.value)}
                required
                value={code}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]">
              {t('locations.name')}
              <input
                className="min-h-11 rounded-xl border border-[var(--border)] bg-white px-3 outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-wash)]"
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>
            <Button className="sm:col-span-2 sm:justify-self-start" disabled={busy} type="submit">
              <Check aria-hidden="true" size={17} />
              {t('locations.createBranch')}
            </Button>
          </form>
        </Card>
      )}
    </LocationSelectionLayout>
  )
}

export function WarehouseSelectionScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { organization } = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const branchId = useWorkspaceStore((state) => state.branchId)
  const setWarehouse = useWorkspaceStore((state) => state.setWarehouse)
  const clearWorkspace = useWorkspaceStore((state) => state.clearWorkspace)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [branchName, setBranchName] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [warehouseType, setWarehouseType] = useState<NonNullable<Warehouse['warehouseType']>>('fabrics')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canManage = Boolean(user?.permissions.includes('settings.manage'))

  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      if (!user || !branchId) {
        navigate('/branch-selection', { replace: true })
        return
      }
      setError('')
      try {
        const branches = await organization.listAccessibleBranches(user.id)
        const branch = branches.find((item) => item.id === branchId)
        if (!branch) {
          clearWorkspace()
          navigate('/branch-selection', { replace: true })
          return
        }
        const available = await organization.listAccessibleWarehouses(user.id, branchId)
        if (!active) return
        setWarehouses(available.filter((item) =>
          item.branchId === branchId && item.status === 'active',
        ))
        setBranchName(branch.name)
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : t('locations.loadFailed'))
        }
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [branchId, clearWorkspace, navigate, organization, t, user])

  const create = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !branchId || !canManage) return
    setBusy(true)
    setError('')
    try {
      await organization.createWarehouse(user.id, {
        branchId,
        code,
        name,
        warehouseType,
      })
      const available = await organization.listAccessibleWarehouses(user.id, branchId)
      setWarehouses(available.filter((item) =>
        item.branchId === branchId && item.status === 'active',
      ))
      setCode('')
      setName('')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('locations.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <LocationSelectionLayout
      title={t('locations.warehouseTitle')}
      description={t('locations.warehouseDescription', { branch: branchName })}
      icon={<WarehouseIcon aria-hidden="true" size={22} />}
      error={error}
      backTo="/branch-selection"
    >
      {warehouses.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {warehouses.map((warehouse) => (
            <li key={warehouse.id}>
              <button
                className="group flex min-h-28 w-full items-center gap-4 rounded-2xl border border-[var(--border)] bg-white p-4 text-start shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-[var(--brand-border)] hover:shadow-[var(--shadow-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] sm:p-5"
                onClick={() => {
                  setWarehouse(warehouse.id)
                  navigate('/dashboard', { replace: true })
                }}
                type="button"
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--brand-wash)] text-[var(--brand)] transition-colors group-hover:bg-[var(--brand)] group-hover:text-white">
                  <WarehouseIcon aria-hidden="true" size={22} />
                </span>
                <span className="min-w-0 flex-1 text-start">
                  <span className="block truncate text-base font-extrabold text-[var(--ink)]">{warehouse.name}</span>
                  <span className="mt-2 block truncate text-xs font-medium text-[var(--muted)]">
                    {warehouse.warehouseType
                      ? t(`locations.warehouseTypes.${warehouse.warehouseType}`)
                      : t('locations.warehouseTypes.unknown')}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-2">
                  <span className="max-w-24 truncate rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-bold text-[var(--muted)]">
                    {warehouse.code}
                  </span>
                  <ArrowRight aria-hidden="true" className="text-[var(--brand)] rtl:rotate-180" size={18} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {warehouses.length === 0 && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          {t('locations.noWarehouses')}
        </p>
      )}
      {canManage && branchId && (
        <Card as="article" className="overflow-hidden border-[var(--brand-border)]">
          <form className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5" onSubmit={(event) => void create(event)}>
            <div className="flex items-center gap-3 sm:col-span-2">
              <span className="grid size-10 place-items-center rounded-xl bg-[var(--brand-wash)] text-[var(--brand)]">
                <WarehouseIcon aria-hidden="true" size={19} />
              </span>
              <h2 className="font-extrabold text-[var(--ink)]">{t('locations.addWarehouse')}</h2>
            </div>
            <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]">
              {t('locations.code')}
              <input
                className="min-h-11 rounded-xl border border-[var(--border)] bg-white px-3 outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-wash)]"
                maxLength={32}
                minLength={2}
                onChange={(event) => setCode(event.target.value)}
                required
                value={code}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]">
              {t('locations.name')}
              <input
                className="min-h-11 rounded-xl border border-[var(--border)] bg-white px-3 outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-wash)]"
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)] sm:col-span-2">
              {t('locations.warehouseType')}
              <select
                className="min-h-11 rounded-xl border border-[var(--border)] bg-white px-3 outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-wash)]"
                onChange={(event) => setWarehouseType(event.target.value as NonNullable<Warehouse['warehouseType']>)}
                required
                value={warehouseType}
              >
                <option value="clothing_manufacturing">{t('locations.warehouseTypes.clothing_manufacturing')}</option>
                <option value="fabrics">{t('locations.warehouseTypes.fabrics')}</option>
              </select>
            </label>
            <Button className="sm:col-span-2 sm:justify-self-start" disabled={busy} type="submit">
              <Check aria-hidden="true" size={17} />
              {t('locations.createWarehouse')}
            </Button>
          </form>
        </Card>
      )}
    </LocationSelectionLayout>
  )
}

export function BranchesManagementScreen() {
  const { t } = useTranslation()
  const { organization } = useRetailApplicationServices()
  const confirm = useConfirmDialog()
  const user = useSessionStore((state) => state.user)
  const { branchId: selectedBranchId, warehouseId: selectedWarehouseId, clearWorkspace } = useWorkspaceStore()
  const canManage = Boolean(user?.permissions.includes('settings.manage'))
  const [warehouseTypeFilter, setWarehouseTypeFilter] = useState<
    'all' | 'clothing_manufacturing' | 'fabrics' | 'unknown'
  >('all')
  const [branches, setBranches] = useState<Branch[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [editingBranch, setEditingBranch] = useState<string | null>(null)
  const [editingWarehouse, setEditingWarehouse] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadLocations = async (): Promise<void> => {
    if (!user) return
    setError('')
    try {
      const availableBranches = canManage
        ? await organization.listBranches(user.id)
        : await organization.listAccessibleBranches(user.id)
      const availableWarehouses = canManage
        ? await organization.listWarehouses(user.id)
        : (await Promise.all(availableBranches.map((branch) =>
          organization.listAccessibleWarehouses(user.id, branch.id),
        ))).flat()
      const activeBranches = availableBranches.filter((branch) => branch.status === 'active')
      const activeBranchIds = new Set(activeBranches.map((branch) => branch.id))
      setBranches(activeBranches)
      setWarehouses(availableWarehouses.filter((warehouse) =>
        warehouse.status !== 'archived' && activeBranchIds.has(warehouse.branchId),
      ))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('locations.loadFailed'))
    }
  }

  useEffect(() => {
    let active = true
    if (!user) return
    void (async () => {
      try {
        const availableBranches = canManage
          ? await organization.listBranches(user.id)
          : await organization.listAccessibleBranches(user.id)
        const availableWarehouses = canManage
          ? await organization.listWarehouses(user.id)
          : (await Promise.all(availableBranches.map((branch) =>
            organization.listAccessibleWarehouses(user.id, branch.id),
          ))).flat()
        if (active) {
          const activeBranches = availableBranches.filter((branch) => branch.status === 'active')
          const activeBranchIds = new Set(activeBranches.map((branch) => branch.id))
          setBranches(activeBranches)
          setWarehouses(availableWarehouses.filter((warehouse) =>
            warehouse.status !== 'archived' && activeBranchIds.has(warehouse.branchId),
          ))
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : t('locations.loadFailed'))
        }
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [canManage, organization, t, user])

  const archiveBranch = async (branch: Branch): Promise<void> => {
    if (!user || !canManage || !(await confirm({
      message: t('locations.confirmArchiveBranch', { name: branch.name }),
      destructive: true,
    }))) return
    setBusy(true)
    setError('')
    try {
      await organization.archiveBranch(user.id, branch.id)
      if (selectedBranchId === branch.id) clearWorkspace()
      await loadLocations()
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : t('locations.operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  const archiveWarehouse = async (warehouse: Warehouse): Promise<void> => {
    if (!user || !canManage || !(await confirm({
      message: t('locations.confirmArchiveWarehouse', { name: warehouse.name }),
      destructive: true,
    }))) return
    setBusy(true)
    setError('')
    try {
      await organization.archiveWarehouse(user.id, warehouse.id)
      if (selectedWarehouseId === warehouse.id) clearWorkspace()
      await loadLocations()
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : t('locations.operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--brand-wash)] text-[var(--brand)]">
          <Building2 aria-hidden="true" size={23} />
        </span>
        <div>
          <h1 className="text-2xl font-black text-[var(--ink)]">{t('locations.branchesManagementTitle')}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{t('locations.branchesManagementDescription')}</p>
        </div>
      </header>
      {error && <><ToastError error={error} /><p className="rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</p></>}
      {loading && <p className="rounded-xl bg-white p-4 text-sm text-[var(--muted)]" role="status">{t('auth.working')}</p>}
      <label className="grid max-w-sm gap-1 text-sm font-semibold text-[var(--ink)]">
        {t('locations.filterWarehouseType')}
        <select
          className="min-h-11 rounded-xl border border-[var(--border)] bg-white px-3"
          onChange={(event) => setWarehouseTypeFilter(event.target.value as typeof warehouseTypeFilter)}
          value={warehouseTypeFilter}
        >
          <option value="all">{t('locations.allWarehouseTypes')}</option>
          <option value="clothing_manufacturing">{t('locations.warehouseTypes.clothing_manufacturing')}</option>
          <option value="fabrics">{t('locations.warehouseTypes.fabrics')}</option>
          <option value="unknown">{t('locations.warehouseTypes.unknown')}</option>
        </select>
      </label>
      {branches.length === 0 && !error && (
        !loading && <p className="rounded-2xl border border-[var(--border)] bg-white p-6 text-sm text-[var(--muted)]">{t('locations.noBranches')}</p>
      )}
      <div className="grid gap-5">
        {branches.map((branch) => (
          <BranchManagementCard
            branch={branch}
            busy={busy}
            canManage={canManage}
            editing={editingBranch === branch.id}
            key={`${branch.id}:${branch.updatedAt}`}
            onArchive={() => void archiveBranch(branch)}
            onCancel={() => setEditingBranch(null)}
            onEdit={() => {
              setEditingWarehouse(null)
              setEditingBranch(branch.id)
            }}
            onSave={async (input) => {
              if (!user) return
              setBusy(true)
              setError('')
              try {
                await organization.updateBranch(user.id, branch.id, input)
                setEditingBranch(null)
                await loadLocations()
              } catch (saveError) {
                setError(saveError instanceof Error ? saveError.message : t('locations.operationFailed'))
              } finally {
                setBusy(false)
              }
            }}
            t={t}
            warehouses={warehouses.filter((warehouse) =>
              warehouse.branchId === branch.id &&
              (
                warehouseTypeFilter === 'all' ||
                (warehouseTypeFilter === 'unknown'
                  ? warehouse.warehouseType === null
                  : warehouse.warehouseType === warehouseTypeFilter)
              ),
            )}
            editingWarehouse={editingWarehouse}
            onEditWarehouse={(warehouseId) => {
              setEditingBranch(null)
              setEditingWarehouse(warehouseId)
            }}
            onCancelWarehouse={() => setEditingWarehouse(null)}
            onSaveWarehouse={async (warehouse, input) => {
              if (!user) return
              setBusy(true)
              setError('')
              try {
                await organization.updateWarehouse(user.id, warehouse.id, {
                  branchId: warehouse.branchId,
                  ...input,
                })
                setEditingWarehouse(null)
                await loadLocations()
              } catch (saveError) {
                setError(saveError instanceof Error ? saveError.message : t('locations.operationFailed'))
              } finally {
                setBusy(false)
              }
            }}
            onArchiveWarehouse={(warehouse) => void archiveWarehouse(warehouse)}
          />
        ))}
      </div>
    </main>
  )
}

function BranchManagementCard({
  branch,
  warehouses,
  canManage,
  editing,
  editingWarehouse,
  busy,
  onEdit,
  onCancel,
  onSave,
  onArchive,
  onEditWarehouse,
  onCancelWarehouse,
  onSaveWarehouse,
  onArchiveWarehouse,
  t,
}: {
  branch: Branch
  warehouses: Warehouse[]
  canManage: boolean
  editing: boolean
  editingWarehouse: string | null
  busy: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (input: { code: string; name: string; address: string | null; phone: string | null }) => Promise<void>
  onArchive: () => void
  onEditWarehouse: (warehouseId: string) => void
  onCancelWarehouse: () => void
  onSaveWarehouse: (warehouse: Warehouse, input: {
    code: string
    name: string
    warehouseType: NonNullable<Warehouse['warehouseType']>
    address: string | null
    description: string | null
    status: 'active' | 'inactive'
  }) => Promise<void>
  onArchiveWarehouse: (warehouse: Warehouse) => void
  t: TFunction
}) {
  const [code, setCode] = useState(branch.code)
  const [name, setName] = useState(branch.name)
  const [address, setAddress] = useState(branch.address ?? '')
  const [phone, setPhone] = useState(branch.phone ?? '')
  const active = branch.status === 'active'

  return (
    <Card className="overflow-hidden border-2 border-[var(--brand-border)] shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-br from-[var(--brand-wash)] via-white to-white p-4 sm:p-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white text-[var(--brand)] shadow-sm">
            <MapPin aria-hidden="true" size={19} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black text-[var(--ink)]">{branch.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--muted)]">
              <span className="rounded-full border border-[var(--border)] bg-white px-2.5 py-1">{branch.code}</span>
              <span className="rounded-full border border-[var(--border)] bg-white px-2.5 py-1">{t(`locations.status.${branch.status}`)}</span>
              <span className="rounded-full border border-[var(--brand-border)] bg-white px-2.5 py-1 text-[var(--brand)]">
                {warehouses.length} · {t('locations.warehouses')}
              </span>
            </div>
          </div>
        </div>
        {canManage && active && !editing && (
          <div className="flex gap-2">
            <Button onClick={onEdit} variant="secondary"><Pencil aria-hidden="true" size={16} />{t('locations.edit')}</Button>
            <Button className="text-red-700" disabled={busy} onClick={onArchive} variant="secondary"><Archive aria-hidden="true" size={16} />{t('locations.delete')}</Button>
          </div>
        )}
      </div>
      {editing && (
        <form
          className="grid gap-3 border-t border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-2 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault()
            void onSave({ code, name, address: address || null, phone: phone || null })
          }}
        >
          <LocationInput label={t('locations.code')} value={code} onChange={setCode} maxLength={32} />
          <LocationInput label={t('locations.name')} value={name} onChange={setName} maxLength={120} />
          <LocationInput label={t('locations.address')} value={address} onChange={setAddress} maxLength={500} required={false} />
          <LocationInput label={t('locations.phone')} value={phone} onChange={setPhone} maxLength={40} required={false} />
          <EditActions busy={busy} onCancel={onCancel} t={t} />
        </form>
      )}
      <section className="border-t border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl bg-white text-[var(--brand)] shadow-sm">
            <WarehouseIcon aria-hidden="true" size={18} />
          </span>
          <h3 className="text-sm font-extrabold text-[var(--ink)]">{t('locations.warehouses')}</h3>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-[var(--muted)]">{warehouses.length}</span>
        </div>
        {warehouses.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-4 text-sm text-[var(--muted)]">{t('locations.noWarehouses')}</p>
        ) : (
          <ul className="grid gap-3">
            {warehouses.map((warehouse) => (
              <li className="rounded-2xl border border-[var(--border)] bg-white p-3 shadow-[var(--shadow-soft)] sm:p-4" key={warehouse.id}>
                {editingWarehouse === warehouse.id ? (
                  <WarehouseEditForm
                    warehouse={warehouse}
                    busy={busy}
                    onCancel={onCancelWarehouse}
                    onSave={onSaveWarehouse}
                    t={t}
                  />
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--brand-wash)] text-[var(--brand)]">
                        <WarehouseIcon aria-hidden="true" size={17} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-[var(--ink)]">{warehouse.name}</p>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          {warehouse.code} · {warehouse.warehouseType
                            ? t(`locations.warehouseTypes.${warehouse.warehouseType}`)
                            : t('locations.warehouseTypes.unknown')} · {t(`locations.status.${warehouse.status}`)}
                        </p>
                      </div>
                    </div>
                    {canManage && warehouse.status !== 'archived' && (
                      <div className="flex gap-2">
                        <Button onClick={() => onEditWarehouse(warehouse.id)} variant="secondary"><Pencil aria-hidden="true" size={15} />{t('locations.edit')}</Button>
                        <Button className="text-red-700" disabled={busy} onClick={() => onArchiveWarehouse(warehouse)} variant="secondary"><Archive aria-hidden="true" size={15} />{t('locations.delete')}</Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  )
}

function WarehouseEditForm({
  warehouse,
  busy,
  onCancel,
  onSave,
  t,
}: {
  warehouse: Warehouse
  busy: boolean
  onCancel: () => void
  onSave: (warehouse: Warehouse, input: {
    code: string
    name: string
    warehouseType: NonNullable<Warehouse['warehouseType']>
    address: string | null
    description: string | null
    status: 'active' | 'inactive'
  }) => Promise<void>
  t: TFunction
}) {
  const [code, setCode] = useState(warehouse.code)
  const [name, setName] = useState(warehouse.name)
  const [warehouseType, setWarehouseType] = useState<NonNullable<Warehouse['warehouseType']>>(
    warehouse.warehouseType ?? 'fabrics',
  )
  const [address, setAddress] = useState(warehouse.address ?? '')
  const [description, setDescription] = useState(warehouse.description ?? '')
  const [status, setStatus] = useState<'active' | 'inactive'>(
    warehouse.status === 'inactive' ? 'inactive' : 'active',
  )
  return (
    <form
      className="grid gap-2 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault()
        void onSave(warehouse, {
          code,
          name,
          warehouseType,
          address: address || null,
          description: description || null,
          status,
        })
      }}
    >
      <LocationInput label={t('locations.code')} value={code} onChange={setCode} />
      <LocationInput label={t('locations.name')} value={name} onChange={setName} />
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink)]">
        {t('locations.warehouseType')}
        <select
          className="min-h-10 rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
          onChange={(event) => setWarehouseType(event.target.value as NonNullable<Warehouse['warehouseType']>)}
          required
          value={warehouseType}
        >
          <option value="clothing_manufacturing">{t('locations.warehouseTypes.clothing_manufacturing')}</option>
          <option value="fabrics">{t('locations.warehouseTypes.fabrics')}</option>
        </select>
      </label>
      <LocationInput label={t('locations.address')} value={address} onChange={setAddress} maxLength={500} required={false} />
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink)]">
        {t('locations.description')}
        <textarea
          className="min-h-10 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm"
          maxLength={1000}
          onChange={(event) => setDescription(event.target.value)}
          value={description}
        />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink)]">
        {t('locations.statusLabel')}
        <select
          className="min-h-10 rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
          onChange={(event) => setStatus(event.target.value as 'active' | 'inactive')}
          value={status}
        >
          <option value="active">{t('locations.status.active')}</option>
          <option value="inactive">{t('locations.status.inactive')}</option>
        </select>
      </label>
      <EditActions busy={busy} onCancel={onCancel} t={t} />
    </form>
  )
}

function LocationInput({
  label,
  value,
  onChange,
  maxLength = 120,
  required = true,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  maxLength?: number
  required?: boolean
}) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-[var(--ink)]">
      {label}
      <input
        className="min-h-10 rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        value={value}
      />
    </label>
  )
}

function EditActions({
  busy,
  onCancel,
  t,
}: {
  busy: boolean
  onCancel: () => void
  t: TFunction
}) {
  return (
    <div className="flex items-end gap-2 sm:col-span-2">
      <Button disabled={busy} type="submit">{t('locations.save')}</Button>
      <Button onClick={onCancel} variant="secondary">{t('locations.cancel')}</Button>
    </div>
  )
}

function LocationSelectionLayout({
  title,
  description,
  icon,
  error,
  backTo,
  children,
}: {
  title: string
  description: string
  icon: ReactNode
  error: string
  backTo?: string
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { authentication } = useRetailApplicationServices()
  const [logoutError, setLogoutError] = useState('')
  const activeStep = backTo ? 2 : 1

  const signOut = async (): Promise<void> => {
    useWorkspaceStore.getState().clearWorkspace()
    setLogoutError('')
    try {
      await authentication.logout()
      navigate('/login', { replace: true })
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : t('auth.logoutFailed'),
      )
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--surface)] px-4 py-8 sm:px-8 sm:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-[var(--brand-wash)]/80 to-transparent" />
      <div className="absolute end-4 top-4 z-10 sm:end-8 sm:top-8">
        <LanguageSwitcher />
      </div>
      <div className="relative mx-auto flex w-full max-w-4xl flex-col gap-5 pt-14 sm:pt-10">
        <div aria-label={title} className="mx-auto flex w-full max-w-xl items-center px-4">
          {[1, 2].map((step) => (
            <div className="flex flex-1 items-center last:flex-none" key={step}>
              <span className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-extrabold transition ${
                step < activeStep
                  ? 'bg-[var(--brand)] text-white'
                  : step === activeStep
                    ? 'bg-[var(--brand)] text-white ring-4 ring-[var(--brand-wash)]'
                    : 'border border-[var(--border)] bg-white text-[var(--muted)]'
              }`}>
                {step < activeStep ? <Check aria-hidden="true" size={17} /> : step}
              </span>
              {step === 1 && (
                <span className={`mx-3 h-0.5 flex-1 rounded-full ${activeStep === 2 ? 'bg-[var(--brand)]' : 'bg-[var(--border)]'}`} />
              )}
            </div>
          ))}
        </div>

        <Card className="w-full overflow-hidden border-white/80 shadow-[0_24px_70px_-30px_rgba(16,44,33,0.3)]">
          <header className="relative overflow-hidden bg-gradient-to-br from-[var(--brand)] to-[var(--brand-strong)] px-5 py-7 text-white sm:px-8 sm:py-9">
            <div aria-hidden="true" className="absolute -end-10 -top-20 size-56 rounded-full border-[28px] border-white/5" />
            <div className="relative flex items-center gap-4">
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl border border-white/20 bg-white/10 text-white shadow-inner">
                {icon}
              </span>
              <div className="min-w-0">
                <p className="mb-1 text-xs font-bold tracking-wide text-emerald-100">
                  {activeStep} / 2
                </p>
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{title}</h1>
                <p className="mt-1 text-sm text-emerald-50/90">{description}</p>
              </div>
            </div>
          </header>
          <div className="space-y-6 p-4 sm:p-7">
            {(error || logoutError) && (
              <>
                <ToastError error={logoutError || error} />
                <p className="rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">
                  {logoutError || error}
                </p>
              </>
            )}
            <div className="space-y-5">{children}</div>
            <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
              {backTo && (
                <Button onClick={() => navigate(backTo)} variant="secondary">
                  <ArrowRight aria-hidden="true" className="ltr:rotate-180" size={16} />
                  {t('locations.back')}
                </Button>
              )}
              <Button className="ms-auto" onClick={() => void signOut()} variant="secondary">
                {t('auth.signOut')}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </main>
  )
}
