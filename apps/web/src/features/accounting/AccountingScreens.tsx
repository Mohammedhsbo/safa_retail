import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Banknote, ReceiptText } from 'lucide-react'
import { useRetailApplicationServices } from '../../app/RetailApplicationServices'
import { useSessionStore } from '../auth/session-store'
import { useWorkspaceStore } from '../../shared/state/workspace-store'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { ToastError } from '../../shared/components/ToastError'
import { formatLocaleDate } from '../../shared/i18n/formatDate'
import type { Cashbox, CashMovement, Expense } from './AccountingService'

const fieldClass = 'min-h-11 w-full rounded-xl border border-[var(--border)] bg-white px-3 text-[var(--ink)]'

export function ExpensesScreen() {
  const { t } = useTranslation()
  const { accounting } = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const branchId = useWorkspaceStore((state) => state.branchId)
  const canManage = Boolean(user?.permissions.includes('accounting.manage'))
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [cashboxId, setCashboxId] = useState('')
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!user || !branchId) return
    const [availableExpenses, availableCashboxes] = await Promise.all([
      user.permissions.includes('accounting.read')
        ? accounting.listExpenses(user.id, branchId)
        : Promise.resolve([]),
      user.permissions.includes('accounting.read')
        ? accounting.listCashboxes(user.id, branchId)
        : Promise.resolve([]),
    ])
    setExpenses(availableExpenses)
    setCashboxes(availableCashboxes.filter((item) => item.status === 'active'))
  }, [accounting, branchId, user])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('accounting.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !branchId || !canManage) return
    setBusy(true)
    setError('')
    try {
      await accounting.createExpense(user.id, { branchId, cashboxId, category, amount, description })
      setCategory('')
      setAmount('')
      setDescription('')
      await load()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t('accounting.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AccountingPage title={t('accounting.expensesTitle')} description={t('accounting.expensesDescription')} icon={<ReceiptText aria-hidden="true" size={22} />} error={error}>
      {canManage && cashboxes.length > 0 && (
        <Card className="space-y-3 p-5">
          <h2 className="font-bold">{t('accounting.recordExpense')}</h2>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
            <label className="grid gap-1 text-sm font-semibold">{t('accounting.cashbox')}
              <select className={fieldClass} onChange={(event) => setCashboxId(event.target.value)} required value={cashboxId}>
                <option value="">{t('accounting.chooseCashbox')}</option>
                {cashboxes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.balance}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">{t('accounting.category')}
              <input className={fieldClass} maxLength={80} onChange={(event) => setCategory(event.target.value)} required value={category} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">{t('accounting.amount')}
              <input className={fieldClass} inputMode="decimal" min="0.000000001" onChange={(event) => setAmount(event.target.value)} required value={amount} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">{t('accounting.description')}
              <input className={fieldClass} maxLength={500} minLength={2} onChange={(event) => setDescription(event.target.value)} required value={description} />
            </label>
            <Button disabled={busy || !cashboxId}>{busy ? t('accounting.working') : t('accounting.saveExpense')}</Button>
          </form>
        </Card>
      )}
      {!user?.permissions.includes('accounting.read') ? (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{t('accounting.readPermissionRequired')}</p>
      ) : expenses.length === 0 ? (
        <p className="rounded-xl bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t('accounting.noExpenses')}</p>
      ) : expenses.map((item) => (
        <Card className="grid gap-2 p-4 sm:grid-cols-[1fr_auto_auto]" key={item.id}>
          <span><span className="block font-bold">{item.category}</span><span className="text-sm text-[var(--muted)]">{item.description}</span></span>
          <span className="font-bold">{item.amount}</span>
          <span className="text-sm text-[var(--muted)]">{formatLocaleDate(item.incurredAt)}</span>
        </Card>
      ))}
    </AccountingPage>
  )
}

export function CashboxesScreen() {
  const { t } = useTranslation()
  const { accounting } = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const branchId = useWorkspaceStore((state) => state.branchId)
  const canManage = Boolean(user?.permissions.includes('accounting.manage'))
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [movements, setMovements] = useState<CashMovement[]>([])
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [entryAmount, setEntryAmount] = useState('')
  const [entryDescription, setEntryDescription] = useState('')
  const [entryType, setEntryType] = useState<'receipt' | 'disbursement'>('receipt')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!user || !branchId || !user.permissions.includes('accounting.read')) return
    setCashboxes(await accounting.listCashboxes(user.id, branchId))
  }, [accounting, branchId, user])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('accounting.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  useEffect(() => {
    let active = true
    if (!user || !selectedId) {
      void Promise.resolve().then(() => { if (active) setMovements([]) })
      return () => { active = false }
    }
    void accounting.getCashboxMovements(user.id, selectedId).then((result) => {
      if (active) setMovements(result)
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('accounting.movementsFailed'))
    })
    return () => { active = false }
  }, [accounting, selectedId, t, user])

  const create = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !branchId) return
    setBusy(true)
    setError('')
    try {
      const id = await accounting.createCashbox(user.id, { branchId, code, name })
      setSelectedId(id)
      setCode('')
      setName('')
      await load()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('accounting.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const recordEntry = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !selectedId) return
    setBusy(true)
    setError('')
    try {
      const input = { cashboxId: selectedId, amount: entryAmount, description: entryDescription }
      if (entryType === 'receipt') await accounting.recordCashReceipt(user.id, input)
      else await accounting.recordCashDisbursement(user.id, input)
      setEntryAmount('')
      setEntryDescription('')
      await load()
      setMovements(await accounting.getCashboxMovements(user.id, selectedId))
    } catch (entryError) {
      setError(entryError instanceof Error ? entryError.message : t('accounting.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AccountingPage title={t('accounting.cashboxesTitle')} description={t('accounting.cashboxesDescription')} icon={<Banknote aria-hidden="true" size={22} />} error={error}>
      {canManage && (
        <Card className="space-y-3 p-5">
          <h2 className="font-bold">{t('accounting.createCashbox')}</h2>
          <form className="grid gap-3 sm:grid-cols-3" onSubmit={(event) => void create(event)}>
            <input aria-label={t('accounting.code')} className={fieldClass} maxLength={32} minLength={2} onChange={(event) => setCode(event.target.value)} placeholder={t('accounting.code')} required value={code} />
            <input aria-label={t('accounting.name')} className={fieldClass} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={t('accounting.name')} required value={name} />
            <Button disabled={busy}>{t('accounting.create')}</Button>
          </form>
        </Card>
      )}
      {cashboxes.length === 0 ? (
        <p className="rounded-xl bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t('accounting.noCashboxes')}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {cashboxes.map((cashbox) => (
              <button className={`rounded-2xl border p-4 text-start ${selectedId === cashbox.id ? 'border-[var(--brand)] bg-[var(--brand-wash)]' : 'border-[var(--border)] bg-white'}`} key={cashbox.id} onClick={() => setSelectedId(cashbox.id)} type="button">
                <span className="block font-bold">{cashbox.name}</span>
                <span className="text-sm text-[var(--muted)]">{cashbox.code} · {cashbox.balance}</span>
              </button>
            ))}
          </div>
          {canManage && selectedId && (
            <Card className="space-y-3 p-5">
              <h2 className="font-bold">{t('accounting.recordMovement')}</h2>
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void recordEntry(event)}>
                <select aria-label={t('accounting.movementType')} className={fieldClass} onChange={(event) => {
                  if (event.target.value === 'receipt' || event.target.value === 'disbursement') setEntryType(event.target.value)
                }} value={entryType}>
                  <option value="receipt">{t('accounting.receipt')}</option>
                  <option value="disbursement">{t('accounting.disbursement')}</option>
                </select>
                <input aria-label={t('accounting.amount')} className={fieldClass} inputMode="decimal" min="0.000000001" onChange={(event) => setEntryAmount(event.target.value)} placeholder={t('accounting.amount')} required value={entryAmount} />
                <input aria-label={t('accounting.description')} className={fieldClass} maxLength={500} minLength={2} onChange={(event) => setEntryDescription(event.target.value)} placeholder={t('accounting.description')} required value={entryDescription} />
                <Button disabled={busy}>{t('accounting.saveMovement')}</Button>
              </form>
            </Card>
          )}
          {selectedId && (
            <Card className="space-y-3 p-5">
              <h2 className="font-bold">{t('accounting.movements')}</h2>
              {movements.length === 0 ? <p className="text-sm text-[var(--muted)]">{t('accounting.noMovements')}</p> : movements.map((movement) => (
                <div className="flex flex-wrap justify-between gap-2 border-b border-[var(--border)] pb-2 text-sm" key={movement.id}>
                  <span>{t(`accounting.movement.${movement.movementType}`, movement.movementType)}</span>
                  <span>{movement.amount}</span>
                  <span className="text-[var(--muted)]">{formatLocaleDate(movement.occurredAt, true)}</span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </AccountingPage>
  )
}

function AccountingPage({
  title,
  description,
  icon,
  error,
  children,
}: {
  title: string
  description: string
  icon: ReactNode
  error: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-8">
      <header className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--brand-wash)] text-[var(--brand)]">{icon}</span>
        <div><h1 className="text-2xl font-black text-[var(--ink)]">{title}</h1><p className="mt-1 text-sm text-[var(--muted)]">{description}</p></div>
      </header>
      {error && <><ToastError error={error} /><p className="rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</p></>}
      <nav aria-label={t('accounting.navigation')} className="flex flex-wrap gap-2">
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/expenses">{t('accounting.expensesTitle')}</Link>
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/cashboxes">{t('accounting.cashboxesTitle')}</Link>
      </nav>
      {children}
    </main>
  )
}
