import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { KeyRound, Plus, Shield, ShieldCheck, Trash2, UsersRound } from 'lucide-react'
import { useRetailApplicationServices } from '../../app/RetailApplicationServices'
import { useSessionStore } from '../auth/session-store'
import { useWorkspaceStore } from '../../shared/state/workspace-store'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { useConfirmDialog } from '../../shared/components/ConfirmDialog'
import { ToastError } from '../../shared/components/ToastError'
import { formatLocaleDate } from '../../shared/i18n/formatDate'

const fieldClass = 'min-h-11 w-full rounded-xl border border-[var(--border)] bg-white px-3 text-[var(--ink)]'

export function UsersScreen() {
  const { t } = useTranslation()
  const confirm = useConfirmDialog()
  const { users, roles, organization } = useRetailApplicationServices()
  const actor = useSessionStore((state) => state.user)
  const workspaceBranchId = useWorkspaceStore((state) => state.branchId)
  const workspaceWarehouseId = useWorkspaceStore((state) => state.warehouseId)
  const [userRows, setUserRows] = useState<Array<{ id: string; username: string; displayName: string; status: string }>>([])
  const [roleRows, setRoleRows] = useState<Array<{ id: string; code: string; name: string }>>([])
  const [branchRows, setBranchRows] = useState<Array<{ id: string; name: string }>>([])
  const [warehouseRows, setWarehouseRows] = useState<Array<{ id: string; name: string }>>([])
  const [selectedBranchId, setSelectedBranchId] = useState(workspaceBranchId ?? '')
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(workspaceWarehouseId ?? '')
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [roleCode, setRoleCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!actor) return
    const [availableUsers, availableRoles] = await Promise.all([
      users.listUsers(actor.id),
      roles.listRoles(actor.id),
    ])
    setUserRows(availableUsers)
    setRoleRows(availableRoles)
    const availableBranches = await organization.listAccessibleBranches(actor.id)
    setBranchRows(availableBranches)
    if (!availableBranches.some((branch) => branch.id === selectedBranchId)) {
      setSelectedBranchId(availableBranches.length === 1 ? availableBranches[0]?.id ?? '' : '')
      setSelectedWarehouseId('')
    }
  }, [actor, organization, roles, selectedBranchId, users])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('admin.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  useEffect(() => {
    let active = true
    if (!actor || !selectedBranchId) return () => { active = false }
    void organization.listAccessibleWarehouses(actor.id, selectedBranchId).then((availableWarehouses) => {
      if (!active) return
      setWarehouseRows(availableWarehouses)
      const currentWarehouse = availableWarehouses.find((warehouse) => warehouse.id === workspaceWarehouseId)
      setSelectedWarehouseId(currentWarehouse?.id ?? (availableWarehouses.length === 1 ? availableWarehouses[0]?.id ?? '' : ''))
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('admin.loadFailed'))
    })
    return () => { active = false }
  }, [actor, organization, selectedBranchId, t, workspaceWarehouseId])

  const createUser = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!actor || !roleCode || !selectedBranchId || !selectedWarehouseId) {
      setError(t('admin.chooseUserLocation'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await users.createUser(actor.id, {
        displayName,
        username,
        password,
        roleCodes: [roleCode],
        branchIds: [selectedBranchId],
        warehouseIds: [selectedWarehouseId],
      })
      setDisplayName('')
      setUsername('')
      setPassword('')
      await load()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('admin.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const toggleStatus = async (id: string, status: string): Promise<void> => {
    if (!actor) return
    setBusy(true)
    setError('')
    try {
      await users.setUserStatus(actor.id, id, status === 'active' ? 'disabled' : 'active')
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('admin.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const deleteUser = async (id: string): Promise<void> => {
    if (!actor || id === actor.id) return
    const confirmed = await confirm({
      title: t('admin.deleteAccount'),
      message: t('admin.confirmDeleteAccount'),
      confirmLabel: t('admin.deleteAccount'),
      destructive: true,
    })
    if (!confirmed) return

    setBusy(true)
    setError('')
    try {
      await users.setUserStatus(actor.id, id, 'archived')
      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t('admin.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return <AdminPage title={t('admin.usersTitle')} error={error}>
    {actor?.permissions.includes('users.manage') && <Card className="space-y-3 p-5">
      <h2 className="font-bold">{t('admin.createUser')}</h2>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void createUser(event)}>
        <input aria-label={t('admin.displayName')} className={fieldClass} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} placeholder={t('admin.displayName')} required value={displayName} />
        <input aria-label={t('admin.username')} autoComplete="username" className={fieldClass} maxLength={64} minLength={3} onChange={(event) => setUsername(event.target.value)} placeholder={t('admin.username')} required value={username} />
        <input aria-label={t('admin.password')} autoComplete="new-password" className={fieldClass} maxLength={128} minLength={12} onChange={(event) => setPassword(event.target.value)} placeholder={t('admin.password')} required type="password" value={password} />
        <select aria-label={t('locations.branchTitle')} className={fieldClass} onChange={(event) => { setSelectedBranchId(event.target.value); setSelectedWarehouseId(''); setWarehouseRows([]) }} required value={selectedBranchId}>
          <option value="">{t('locations.branchTitle')}</option>
          {branchRows.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
        <select aria-label={t('locations.warehouseTitle')} className={fieldClass} disabled={!selectedBranchId} onChange={(event) => setSelectedWarehouseId(event.target.value)} required value={selectedWarehouseId}>
          <option value="">{t('locations.warehouseTitle')}</option>
          {warehouseRows.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
        </select>
        <select aria-label={t('admin.role')} className={fieldClass} onChange={(event) => setRoleCode(event.target.value)} required value={roleCode}>
          <option value="">{t('admin.chooseRole')}</option>
          {roleRows.map((role) => <option key={role.id} value={role.code}>{t(`admin.roleNames.${role.code}`, { defaultValue: role.name })}</option>)}
        </select>
        {branchRows.length === 0 && <p className="text-sm text-[var(--muted)]">{t('admin.noUserLocations')}</p>}
        <Button disabled={busy || branchRows.length === 0 || !selectedBranchId || !selectedWarehouseId || !roleCode} type="submit">{t('admin.createUser')}</Button>
      </form>
    </Card>}
    {userRows.filter((row) => row.status !== 'archived').map((row) => <Card className="flex flex-wrap items-center justify-between gap-3 p-4" key={row.id}>
      <span><span className="block font-bold">{row.displayName}</span><span className="text-sm text-[var(--muted)]">{row.username} · {t(`admin.status.${row.status}`, row.status)}</span></span>
      {actor?.permissions.includes('users.manage') && <div className="flex gap-2">
        {row.id !== actor.id && <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border)] px-4 text-sm font-bold text-[var(--ink)] transition hover:bg-[var(--surface)]" to={`/users/${row.id}`}>{t('admin.editAccount')}</Link>}
        <Button disabled={busy || row.id === actor.id} onClick={() => void toggleStatus(row.id, row.status)} variant="secondary">{row.status === 'active' ? t('admin.disable') : t('admin.enable')}</Button>
        {row.id !== actor.id && <Button className="text-red-700 hover:bg-red-50" disabled={busy} onClick={() => void deleteUser(row.id)} variant="secondary">
          <Trash2 aria-hidden="true" className="me-2 inline" size={16} />
          {t('admin.deleteAccount')}
        </Button>}
      </div>}
    </Card>)}
  </AdminPage>
}

export function UserAccountScreen() {
  const { t } = useTranslation()
  const { users } = useRetailApplicationServices()
  const actor = useSessionStore((state) => state.user)
  const { userId = '' } = useParams()
  const [target, setTarget] = useState<{ id: string; username: string; displayName: string } | null>(null)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    if (!actor) return () => { active = false }
    void users.listUsers(actor.id).then((rows) => {
      if (!active) return
      const found = rows.find((row) => row.id === userId)
      if (found) {
        setTarget(found)
        setUsername(found.username)
        setDisplayName(found.displayName)
      } else {
        setError(t('admin.userNotFound'))
      }
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('admin.loadFailed'))
    })
    return () => { active = false }
  }, [actor, t, userId, users])

  const updateAccount = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!actor || !target) return
    setBusy(true)
    setError('')
    try {
      await users.updateUserAccount(actor.id, target.id, { username, displayName })
      setTarget({ ...target, username: username.trim().toLowerCase(), displayName: displayName.trim() })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('admin.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const resetPassword = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!actor || !target) return
    setBusy(true)
    setError('')
    try {
      await users.resetPassword(actor.id, target.id, password)
      setPassword('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('admin.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return <AdminPage title={t('admin.accountEditorTitle')} error={error}>
    {target && <>
      <p className="text-sm text-[var(--muted)]">{target.displayName} · {target.username}</p>
      <Card className="space-y-4 p-5">
        <h2 className="font-bold">{t('admin.editAccount')}</h2>
        <form className="grid gap-3 sm:max-w-2xl sm:grid-cols-2" onSubmit={(event) => void updateAccount(event)}>
          <label className="space-y-1 text-sm font-semibold">{t('admin.displayName')}
            <input aria-label={t('admin.displayName')} className={fieldClass} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} required value={displayName} />
          </label>
          <label className="space-y-1 text-sm font-semibold">{t('admin.username')}
            <input aria-label={t('admin.username')} autoComplete="username" className={fieldClass} maxLength={64} minLength={3} onChange={(event) => setUsername(event.target.value)} required value={username} />
          </label>
          <Button className="sm:col-span-2" disabled={busy} type="submit">{t('admin.saveAccount')}</Button>
        </form>
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="font-bold">{t('admin.resetPassword')}</h2>
        <form className="grid gap-3 sm:max-w-2xl sm:grid-cols-2" onSubmit={(event) => void resetPassword(event)}>
          <label className="space-y-1 text-sm font-semibold">{t('admin.newPassword')}
            <input aria-label={t('admin.newPassword')} autoComplete="new-password" className={fieldClass} maxLength={128} minLength={12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </label>
          <p className="self-center text-xs text-[var(--muted)]">{t('admin.passwordRequirements')}</p>
          <Button className="sm:col-span-2" disabled={busy} type="submit">{t('admin.resetPassword')}</Button>
        </form>
      </Card>
    </>}
    <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border)] px-4 text-sm font-bold text-[var(--ink)] transition hover:bg-[var(--surface)]" to="/users">{t('admin.backToUsers')}</Link>
  </AdminPage>
}

export function RolesScreen() {
  const { t } = useTranslation()
  const { roles: roleService } = useRetailApplicationServices()
  const actor = useSessionStore((state) => state.user)
  const [roleRows, setRoleRows] = useState<Array<{ id: string; code: string; name: string; isSystem: boolean }>>([])
  const [permissions, setPermissions] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canManage = Boolean(actor?.permissions.includes('roles.manage'))

  const load = useCallback(async (): Promise<void> => {
    if (!actor) return
    const [availableRoles, availablePermissions] = await Promise.all([
      roleService.listRoles(actor.id),
      roleService.listPermissions(actor.id),
    ])
    setRoleRows(availableRoles)
    setPermissions(availablePermissions)
  }, [actor, roleService])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('admin.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  const selectRole = async (id: string): Promise<void> => {
    setSelectedId(id)
    if (!actor || !id) {
      setSelectedPermissions([])
      return
    }
    try {
      setSelectedPermissions(await roleService.getRolePermissions(actor.id, id))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('admin.loadFailed'))
    }
  }

  const createRole = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!actor) return
    setBusy(true)
    setError('')
    try {
      await roleService.createRole(actor.id, newName)
      setNewName('')
      await load()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('admin.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const savePermissions = async (): Promise<void> => {
    if (!actor || !selectedId) return
    setBusy(true)
    setError('')
    try {
      await roleService.setPermissions(actor.id, selectedId, selectedPermissions)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('admin.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const selectedRole = roleRows.find((role) => role.id === selectedId)
  const permissionGroups = [...new Set(permissions.map((permission) => permission.split('.')[0]))]

  return <AdminPage title={t('admin.rolesTitle')} error={error}>
    <header className="overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-[var(--brand)] via-[var(--brand-strong)] to-[#0d3d31] p-5 text-white shadow-[var(--shadow-brand)] sm:p-8">
      <div className="flex items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/20">
          <Shield aria-hidden="true" size={27} />
        </span>
        <div>
          <p className="text-sm font-bold text-white/75">{t('admin.rolesEyebrow')}</p>
          <h2 className="mt-1 text-2xl font-black">{t('admin.rolesTitle')}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-white/80">{t('admin.rolesDescription')}</p>
        </div>
      </div>
      <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-bold ring-1 ring-white/15">
        <UsersRound aria-hidden="true" size={16} />
        {t('admin.rolesCount', { count: roleRows.length })}
      </div>
    </header>

    {canManage && (
      <Card className="p-4 sm:p-6">
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => void createRole(event)}>
          <label className="grid flex-1 gap-1.5 text-sm font-bold text-[var(--ink)]">
            {t('admin.roleName')}
            <input
              aria-label={t('admin.roleName')}
              className={fieldClass}
              maxLength={80}
              minLength={2}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={t('admin.roleNamePlaceholder')}
              required
              value={newName}
            />
          </label>
          <Button className="justify-center sm:min-w-40" disabled={busy}>
            <Plus aria-hidden="true" size={18} />
            {t('admin.createRole')}
          </Button>
        </form>
      </Card>
    )}

    <section aria-label={t('admin.rolesTitle')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {roleRows.map((role) => {
        const rolePermissionCount = selectedId === role.id ? selectedPermissions.length : undefined
        const selected = selectedId === role.id
        return (
          <button
            aria-pressed={selected}
            className={`rounded-3xl border bg-white p-4 text-start shadow-[var(--shadow-soft)] transition hover:-translate-y-0.5 hover:border-[var(--brand-border)] hover:shadow-[var(--shadow-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
              selected ? 'border-[var(--brand)] ring-2 ring-[var(--brand-wash)]' : 'border-[var(--border)]'
            }`}
            key={role.id}
            onClick={() => void selectRole(role.id)}
            type="button"
          >
            <span className="flex items-start justify-between gap-3">
              <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${
                role.isSystem ? 'bg-[var(--brand-wash)] text-[var(--brand)]' : 'bg-[var(--surface)] text-[var(--muted)]'
              }`}>
                {role.isSystem
                  ? <ShieldCheck aria-hidden="true" size={21} />
                  : <UsersRound aria-hidden="true" size={21} />}
              </span>
              {role.isSystem && (
                <span className="rounded-full bg-[var(--brand-wash)] px-2.5 py-1 text-xs font-bold text-[var(--brand)]">
                  {t('admin.systemRole')}
                </span>
              )}
            </span>
            <span className="mt-4 block font-extrabold text-[var(--ink)]">
              {t(`admin.roleNames.${role.code}`, { defaultValue: role.name })}
            </span>
            <span className="mt-1 block text-xs text-[var(--muted)]">{role.code}</span>
            {rolePermissionCount !== undefined && (
              <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-[var(--brand)]">
                <KeyRound aria-hidden="true" size={14} />
                {t('admin.permissionCount', { count: rolePermissionCount })}
              </span>
            )}
          </button>
        )
      })}
    </section>

    {!selectedRole && canManage && (
      <Card className="p-5 text-sm font-semibold text-[var(--muted)]">
        {t('admin.selectRole')}
      </Card>
    )}

    {selectedRole && (
      <Card className="overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-[var(--brand-wash)] text-[var(--brand)]">
              <KeyRound aria-hidden="true" size={21} />
            </span>
            <div>
              <h3 className="font-black text-[var(--ink)]">
                {t(`admin.roleNames.${selectedRole.code}`, { defaultValue: selectedRole.name })}
              </h3>
              <p className="text-sm text-[var(--muted)]">{t('admin.permissionsDescription')}</p>
            </div>
          </div>
          {selectedRole.code === 'system_owner' && (
            <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800">{t('admin.permissionsLocked')}</span>
          )}
        </header>
        <div className="space-y-5 p-4 sm:p-6">
          {permissionGroups.map((group) => (
            <section key={group}>
              <h4 className="mb-2 text-sm font-extrabold text-[var(--ink)]">
                {t(`admin.permissionGroups.${group}`, { defaultValue: group })}
              </h4>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {permissions.filter((permission) => permission.startsWith(`${group}.`)).map((permission) => (
                  <label
                    className="flex min-h-14 items-center gap-3 rounded-2xl border border-[var(--border)] bg-white p-3 text-sm transition hover:border-[var(--brand-border)]"
                    key={permission}
                  >
                    <input
                      checked={selectedPermissions.includes(permission)}
                      className="size-4 accent-[var(--brand)]"
                      disabled={!canManage || selectedRole.code === 'system_owner'}
                      onChange={(event) => setSelectedPermissions((current) =>
                        event.target.checked
                          ? [...current, permission]
                          : current.filter((value) => value !== permission),
                      )}
                      type="checkbox"
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold text-[var(--ink)]">
                        {t(`admin.permissions.${permission}`, { defaultValue: permission })}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-[var(--muted)]">{permission}</span>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ))}
          {canManage && (
            <div className="border-t border-[var(--border)] pt-4">
              <Button
                className="w-full justify-center sm:w-auto"
                disabled={busy || selectedRole.code === 'system_owner'}
                onClick={() => void savePermissions()}
              >
                <ShieldCheck aria-hidden="true" size={18} />
                {busy ? t('auth.working') : t('admin.savePermissions')}
              </Button>
            </div>
          )}
        </div>
      </Card>
    )}
  </AdminPage>
}

export function ApplicationSettingsScreen() {
  const { t } = useTranslation()
  const { businessConfiguration } = useRetailApplicationServices()
  const actor = useSessionStore((state) => state.user)
  const [activities, setActivities] = useState<Array<{ id: string; code: string; name: string; enabled: boolean }>>([])
  const [error, setError] = useState('')
  const [busyCode, setBusyCode] = useState('')

  const load = useCallback(async (): Promise<void> => {
    if (actor) setActivities(await businessConfiguration.listActivities(actor.id))
  }, [actor, businessConfiguration])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('admin.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  const setEnabled = async (code: string, enabled: boolean): Promise<void> => {
    if (!actor) return
    setBusyCode(code)
    setError('')
    try {
      await businessConfiguration.setActivityEnabled(actor.id, code, enabled)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('admin.saveFailed'))
    } finally {
      setBusyCode('')
    }
  }

  return <AdminPage title={t('admin.settingsTitle')} error={error}>
    <Card className="space-y-3 p-5">
      <h2 className="font-bold">{t('admin.businessActivities')}</h2>
      {activities.map((activity) => <label className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-3" key={activity.id}>
        <span><span className="block font-semibold">{t(`admin.activity.${activity.code}`, activity.name)}</span><span className="text-sm text-[var(--muted)]">{activity.code}</span></span>
        <input aria-label={activity.name} checked={activity.enabled} disabled={busyCode === activity.code} onChange={(event) => void setEnabled(activity.code, event.target.checked)} type="checkbox" />
      </label>)}
      <Link className="text-sm font-bold text-[var(--brand)]" to="/settings/backup">{t('navigation.backup')}</Link>
    </Card>
  </AdminPage>
}

export function AuditLogsScreen() {
  const { t } = useTranslation()
  const { administration } = useRetailApplicationServices()
  const actor = useSessionStore((state) => state.user)
  const [entries, setEntries] = useState<Array<{
    action: string
    entity_type: string
    entity_id: string
    occurred_at: string
  }>>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    if (!actor?.permissions.includes('settings.manage')) return () => { active = false }
    void administration.getAuditLogs().then((result) => {
      if (active) setEntries(result)
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('admin.loadFailed'))
    })
    return () => { active = false }
  }, [actor, administration, t])

  return <AdminPage title={t('admin.auditTitle')} error={error}>
    {entries.map((entry, index) => <Card className="grid gap-1 p-4 sm:grid-cols-[1fr_auto]" key={`${entry.entity_id}-${entry.action}-${entry.occurred_at}-${index}`}>
      <span><span className="block font-bold">{entry.action}</span><span className="text-sm text-[var(--muted)]">{entry.entity_type} · {entry.entity_id}</span></span>
      <time className="text-sm text-[var(--muted)]">{formatLocaleDate(entry.occurred_at, true)}</time>
    </Card>)}
    {entries.length === 0 && !error && <p className="rounded-xl bg-[var(--surface)] p-4 text-sm">{t('admin.noAuditEntries')}</p>}
  </AdminPage>
}

function AdminPage({ title, error, children }: { title: string; error: string; children: React.ReactNode }) {
  const { t } = useTranslation()
  const links: Array<[string, string]> = [
    ['/users', t('navigation.users')],
    ['/roles', t('navigation.roles')],
    ['/settings', t('navigation.settings')],
    ['/audit-logs', t('navigation.audit')],
  ]
  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-8">
    <header><h1 className="text-2xl font-black text-[var(--ink)]">{title}</h1></header>
    <nav aria-label={t('admin.navigation')} className="flex flex-wrap gap-2">{links.map(([href, label]) => <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" key={href} to={href}>{label}</Link>)}</nav>
    {error && <><ToastError error={error} /><p className="rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</p></>}
    {children}
  </main>
}
