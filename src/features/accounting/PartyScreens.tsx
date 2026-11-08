import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ContactRound, FileText, Truck } from 'lucide-react'
import { useRetailApplicationServices } from '../../app/RetailApplicationServices'
import { useSessionStore } from '../auth/session-store'
import { useWorkspaceStore } from '../../shared/state/workspace-store'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { useConfirmDialog } from '../../shared/components/ConfirmDialog'
import { ToastError } from '../../shared/components/ToastError'
import { formatLocaleDate } from '../../shared/i18n/formatDate'
import type { Customer, CustomerStatement } from './AccountingService'
import type { Supplier, SupplierStatement } from '../purchases/PurchasesService'

const fieldClass = 'min-h-11 w-full rounded-xl border border-[var(--border)] bg-white px-3 text-[var(--ink)]'

type PartyForm = {
  code: string
  name: string
  phone: string
  email: string
  address: string
  notes: string
}

const emptyParty: PartyForm = {
  code: '',
  name: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
}

export function CustomersScreen() {
  const { t } = useTranslation()
  const { accounting } = useRetailApplicationServices()
  const confirm = useConfirmDialog()
  const user = useSessionStore((state) => state.user)
  const canManage = Boolean(user?.permissions.includes('customers.manage'))
  const [customers, setCustomers] = useState<Customer[]>([])
  const [editing, setEditing] = useState<Customer | null>(null)
  const [form, setForm] = useState<PartyForm>(emptyParty)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    if (!user || !canManage) return
    setCustomers(await accounting.listCustomers(user.id, query))
  }, [accounting, canManage, query, user])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('parties.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !canManage) return
    setError('')
    try {
      const input = {
        ...form,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        notes: form.notes || null,
      }
      if (editing) await accounting.updateCustomer(user.id, editing.id, input)
      else await accounting.createCustomer(user.id, input)
      setEditing(null)
      setForm(emptyParty)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('parties.saveFailed'))
    }
  }

  return (
    <PartyPage title={t('parties.customersTitle')} description={t('parties.customersDescription')} icon={<ContactRound aria-hidden="true" size={22} />} error={error}>
      <label className="grid gap-1 text-sm font-semibold">
        {t('parties.search')}
        <input className={fieldClass} onChange={(event) => setQuery(event.target.value)} value={query} />
      </label>
      {canManage && (
        <PartyFormView
          title={editing ? t('parties.editCustomer') : t('parties.addCustomer')}
          form={form}
          setForm={setForm}
          onSubmit={(event) => void save(event)}
          submitLabel={editing ? t('parties.save') : t('parties.createCustomer')}
          {...(editing ? {
            onCancel: () => { setEditing(null); setForm(emptyParty) },
          } : {})}
        />
      )}
      {customers.length === 0 ? (
        <p className="rounded-xl bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t('parties.noCustomers')}</p>
      ) : (
        <ul className="grid gap-3">
          {customers.map((customer) => (
            <li className="rounded-2xl border border-[var(--border)] bg-white p-4" key={customer.id}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-[var(--ink)]">{customer.name}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{customer.code}{customer.phone ? ` · ${customer.phone}` : ''}</p>
                </div>
                <Link className="text-sm font-bold text-[var(--brand)]" to={`/customers/${customer.id}/statement`}>
                  {t('parties.statement')}
                </Link>
                {canManage && customer.status === 'active' && (
                  <>
                    <Button onClick={() => {
                      setEditing(customer)
                      setForm(partyForm(customer))
                    }} variant="secondary">{t('parties.edit')}</Button>
                    <Button onClick={() => {
                      if (!user) return
                      void confirm({ message: t('parties.confirmArchiveCustomer'), destructive: true })
                        .then((confirmed) => confirmed
                          ? accounting.archiveCustomer(user.id, customer.id)
                          : Promise.resolve())
                        .then(load).catch((archiveError: unknown) => {
                        setError(archiveError instanceof Error ? archiveError.message : t('parties.saveFailed'))
                      })
                    }} variant="secondary">{t('parties.archive')}</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PartyPage>
  )
}

export function CustomerStatementScreen() {
  const { t } = useTranslation()
  const { customerId } = useParams()
  const { accounting } = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const branchId = useWorkspaceStore((state) => state.branchId)
  const [statement, setStatement] = useState<CustomerStatement | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    if (!user || !customerId || !branchId) return
    void accounting.getCustomerStatement(user.id, customerId, branchId).then((result) => {
      if (active) setStatement(result)
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('parties.statementFailed'))
    })
    return () => { active = false }
  }, [accounting, branchId, customerId, t, user])

  return (
    <PartyPage title={t('parties.statementTitle')} description={statement?.customer.name ?? ''} icon={<FileText aria-hidden="true" size={22} />} error={error}>
      <Link className="text-sm font-bold text-[var(--brand)]" to="/customers">{t('parties.backToCustomers')}</Link>
      {statement && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label={t('parties.invoiced')} value={statement.totalInvoiced} />
            <Metric label={t('parties.collected')} value={statement.totalCollected} />
            <Metric label={t('parties.returned')} value={statement.totalReturned} />
            <Metric label={t('parties.refunded')} value={statement.totalRefunded} />
            <Metric label={t('parties.balanceDue')} value={statement.balanceDue} />
            <Metric label={t('parties.customerCredit')} value={statement.customerCredit} />
          </div>
          <StatementEntries
            entries={statement.entries}
            label={(entry) => t(`parties.customerEntry.${entry.type}`)}
          />
        </>
      )}
    </PartyPage>
  )
}

export function SuppliersScreen() {
  const { t } = useTranslation()
  const { purchases } = useRetailApplicationServices()
  const confirm = useConfirmDialog()
  const user = useSessionStore((state) => state.user)
  const canManage = Boolean(user?.permissions.includes('suppliers.manage'))
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [form, setForm] = useState<PartyForm>(emptyParty)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    if (!user || !canManage) return
    setSuppliers(await purchases.listSuppliers(user.id, query))
  }, [canManage, purchases, query, user])
  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('parties.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !canManage) return
    setError('')
    try {
      const input = {
        ...form,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        notes: form.notes || null,
      }
      if (editing) await purchases.updateSupplier(user.id, editing.id, input)
      else await purchases.createSupplier(user.id, input)
      setEditing(null)
      setForm(emptyParty)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('parties.saveFailed'))
    }
  }

  return (
    <PartyPage title={t('parties.suppliersTitle')} description={t('parties.suppliersDescription')} icon={<Truck aria-hidden="true" size={22} />} error={error}>
      <label className="grid gap-1 text-sm font-semibold">
        {t('parties.search')}
        <input className={fieldClass} onChange={(event) => setQuery(event.target.value)} value={query} />
      </label>
      {canManage && (
        <PartyFormView
          title={editing ? t('parties.editSupplier') : t('parties.addSupplier')}
          form={form}
          setForm={setForm}
          onSubmit={(event) => void save(event)}
          submitLabel={editing ? t('parties.save') : t('parties.createSupplier')}
          {...(editing ? {
            onCancel: () => { setEditing(null); setForm(emptyParty) },
          } : {})}
        />
      )}
      {suppliers.length === 0 ? (
        <p className="rounded-xl bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t('parties.noSuppliers')}</p>
      ) : (
        <ul className="grid gap-3">
          {suppliers.map((supplier) => (
            <li className="rounded-2xl border border-[var(--border)] bg-white p-4" key={supplier.id}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-[var(--ink)]">{supplier.name}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{supplier.code}{supplier.phone ? ` · ${supplier.phone}` : ''}</p>
                </div>
                {canManage && supplier.status === 'active' && (
                  <>
                    <Button onClick={() => {
                      setEditing(supplier)
                      setForm(partyForm(supplier))
                    }} variant="secondary">{t('parties.edit')}</Button>
                    <Button onClick={() => {
                      if (!user) return
                      void confirm({ message: t('parties.confirmArchiveSupplier'), destructive: true })
                        .then((confirmed) => confirmed
                          ? purchases.archiveSupplier(user.id, supplier.id)
                          : Promise.resolve())
                        .then(load).catch((archiveError: unknown) => {
                        setError(archiveError instanceof Error ? archiveError.message : t('parties.saveFailed'))
                      })
                    }} variant="secondary">{t('parties.archive')}</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PartyPage>
  )
}

export function SupplierStatementScreen() {
  const { t } = useTranslation()
  const { supplierId } = useParams()
  const { purchases } = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const branchId = useWorkspaceStore((state) => state.branchId)
  const [statement, setStatement] = useState<SupplierStatement | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    if (!user || !supplierId || !branchId) return
    void purchases.getSupplierStatement(user.id, supplierId, branchId).then((result) => {
      if (active) setStatement(result)
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('parties.statementFailed'))
    })
    return () => { active = false }
  }, [branchId, purchases, supplierId, t, user])

  return (
    <PartyPage title={t('parties.supplierStatementTitle')} description={statement?.supplier.name ?? ''} icon={<FileText aria-hidden="true" size={22} />} error={error}>
      <Link className="text-sm font-bold text-[var(--brand)]" to="/suppliers">{t('parties.backToSuppliers')}</Link>
      {statement && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label={t('parties.purchases')} value={statement.totalPurchases} />
            <Metric label={t('parties.payments')} value={statement.totalPayments} />
            <Metric label={t('parties.returns')} value={statement.totalReturns} />
            <Metric label={t('parties.balanceDue')} value={statement.balanceDue} />
            <Metric label={t('parties.supplierCredit')} value={statement.supplierCredit} />
          </div>
          <StatementEntries
            entries={statement.entries}
            label={(entry) => t(`parties.supplierEntry.${entry.type}`)}
          />
        </>
      )}
    </PartyPage>
  )
}

function PartyFormView({
  title,
  form,
  setForm,
  onSubmit,
  submitLabel,
  onCancel,
}: {
  title: string
  form: PartyForm
  setForm: (form: PartyForm) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  submitLabel: string
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const update = (key: keyof PartyForm, value: string): void => {
    setForm({ ...form, [key]: value })
  }
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-bold text-[var(--ink)]">{title}</h2>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={onSubmit}>
        <label className="grid gap-1 text-sm font-semibold">{t('parties.code')}
          <input className={fieldClass} maxLength={32} minLength={2} onChange={(event) => update('code', event.target.value)} required value={form.code} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">{t('parties.name')}
          <input className={fieldClass} maxLength={120} onChange={(event) => update('name', event.target.value)} required value={form.name} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">{t('parties.phone')}
          <input className={fieldClass} maxLength={40} onChange={(event) => update('phone', event.target.value)} value={form.phone} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">{t('parties.email')}
          <input className={fieldClass} maxLength={254} onChange={(event) => update('email', event.target.value)} type="email" value={form.email} />
        </label>
        <label className="grid gap-1 text-sm font-semibold sm:col-span-2">{t('parties.address')}
          <input className={fieldClass} maxLength={500} onChange={(event) => update('address', event.target.value)} value={form.address} />
        </label>
        <label className="grid gap-1 text-sm font-semibold sm:col-span-2">{t('parties.notes')}
          <textarea className={`${fieldClass} min-h-20 py-2`} maxLength={1000} onChange={(event) => update('notes', event.target.value)} value={form.notes} />
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit">{submitLabel}</Button>
          {onCancel && <Button onClick={onCancel} variant="secondary">{t('parties.cancel')}</Button>}
        </div>
      </form>
    </Card>
  )
}

function PartyPage({
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
        <div>
          <h1 className="text-2xl font-black text-[var(--ink)]">{title}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>
        </div>
      </header>
      {error && <><ToastError error={error} /><p className="rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</p></>}
      <nav aria-label={t('parties.navigation')} className="flex flex-wrap gap-2">
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/customers">{t('parties.customersTitle')}</Link>
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/suppliers">{t('parties.suppliersTitle')}</Link>
      </nav>
      {children}
    </main>
  )
}

function StatementEntries({
  entries,
  label,
}: {
  entries: Array<{
    id: string
    type: string
    reference: string
    description: string
    amount: string
    occurredAt: string
    balance: string
  }>
  label: (entry: { type: string }) => string
}) {
  const { t } = useTranslation()
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-bold text-[var(--ink)]">{t('parties.transactions')}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t('parties.noEntries')}</p>
      ) : entries.map((entry) => (
        <div className="grid gap-1 border-b border-[var(--border)] pb-3 text-sm sm:grid-cols-5" key={entry.id}>
          <span className="font-semibold">{label(entry)}</span>
          <span>{entry.reference}</span>
          <span>{entry.amount}</span>
          <span>{entry.balance}</span>
          <span className="text-[var(--muted)]">{formatLocaleDate(entry.occurredAt)}</span>
          <span className="text-[var(--muted)] sm:col-span-5">{entry.description}</span>
        </div>
      ))}
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-xl font-black text-[var(--ink)]">{value}</p>
    </Card>
  )
}

function partyForm(party: Customer | Supplier): PartyForm {
  return {
    code: party.code,
    name: party.name,
    phone: party.phone ?? '',
    email: party.email ?? '',
    address: party.address ?? '',
    notes: party.notes ?? '',
  }
}
