import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ClipboardList, RotateCcw } from 'lucide-react'
import { useRetailApplicationServices } from '../../app/RetailApplicationServices'
import { useSessionStore } from '../auth/session-store'
import { useWorkspaceStore } from '../../shared/state/workspace-store'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { useConfirmDialog } from '../../shared/components/ConfirmDialog'
import { ToastError } from '../../shared/components/ToastError'
import { formatLocaleDate } from '../../shared/i18n/formatDate'
import { translateMeasurementUnit } from '../../shared/i18n/measurementUnits'
import type { Sale } from './SalesService'

const fieldClass = 'min-h-11 w-full rounded-xl border border-[var(--border)] bg-white px-3 text-[var(--ink)]'

export function SalesHistoryScreen() {
  const { t } = useTranslation()
  const { sales } = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const branchId = useWorkspaceStore((state) => state.branchId)
  const [records, setRecords] = useState<Sale[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    if (!user || !branchId) return
    setRecords(await sales.listSales(user.id, { branchId, limit: 100, offset: 0 }))
  }, [branchId, sales, user])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('salesHistory.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  return (
    <SalesPage
      title={t('salesHistory.title')}
      description={t('salesHistory.description')}
      icon={<ClipboardList aria-hidden="true" size={22} />}
      error={error}
    >
      <Button onClick={() => void load().catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : t('salesHistory.loadFailed'))
      })} variant="secondary">
        {t('salesHistory.refresh')}
      </Button>
      {records.length === 0 ? (
        <p className="rounded-xl bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t('salesHistory.empty')}</p>
      ) : (
        <ul className="grid gap-3">
          {records.map((sale) => (
            <li key={sale.id}>
              <Link className="grid gap-2 rounded-2xl border border-[var(--border)] bg-white p-4 hover:border-[var(--brand)] sm:grid-cols-[1fr_auto_auto]" to={`/sales/${sale.id}`}>
                <span>
                  <span className="block font-bold text-[var(--ink)]">{sale.invoiceNumber}</span>
                  <span className="mt-1 block text-sm text-[var(--muted)]">
                    {sale.customerName ?? t('salesPos.walkIn')} · {formatLocaleDate(sale.createdAt, true)}
                  </span>
                </span>
                <span className="text-sm font-bold text-[var(--ink)]">{sale.total}</span>
                <span className="text-sm text-[var(--muted)]">{t(`salesHistory.status.${sale.status}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SalesPage>
  )
}

export function SaleDetailsScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { saleId } = useParams()
  const { sales } = useRetailApplicationServices()
  const confirm = useConfirmDialog()
  const user = useSessionStore((state) => state.user)
  const [sale, setSale] = useState<Sale | null>(null)
  const [error, setError] = useState('')
  const canCancel = Boolean(user?.permissions.includes('sales.cancel'))
  const canReturn = Boolean(user?.permissions.includes('sales.returns'))

  const load = useCallback(async (): Promise<void> => {
    if (!user || !saleId) return
    setSale(await sales.getSale(user.id, saleId))
  }, [saleId, sales, user])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('salesHistory.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  const cancel = async (): Promise<void> => {
    if (!user || !sale || !canCancel || !(await confirm({
      message: t('salesHistory.confirmCancel'),
      destructive: true,
    }))) return
    setError('')
    try {
      await sales.cancelSale(user.id, sale.id)
      await load()
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : t('salesHistory.cancelFailed'))
    }
  }

  return (
    <SalesPage
      title={sale?.invoiceNumber ?? t('salesHistory.invoiceTitle')}
      description={t('salesHistory.invoiceDescription')}
      icon={<ClipboardList aria-hidden="true" size={22} />}
      error={error}
    >
      <Link className="text-sm font-bold text-[var(--brand)]" to="/sales">{t('salesHistory.back')}</Link>
      {sale && (
        <>
          <Card className="grid gap-4 p-5 sm:grid-cols-3">
            <SaleValue label={t('salesHistory.customer')} value={sale.customerName ?? t('salesPos.walkIn')} />
            <SaleValue label={t('salesHistory.date')} value={formatLocaleDate(sale.createdAt, true)} />
            <SaleValue label={t('salesHistory.statusLabel')} value={t(`salesHistory.status.${sale.status}`)} />
            <SaleValue label={t('salesHistory.subtotal')} value={sale.subtotal} />
            {Number(sale.additionalTotal) > 0 && <SaleValue label={`${t('salesPos.additionalAmount')} (${sale.additionalRate}%)`} value={sale.additionalTotal} />}
            <SaleValue label={t('salesHistory.tax')} value={sale.taxTotal} />
            <SaleValue label={t('salesHistory.total')} value={sale.total} />
            <SaleValue label={t('salesHistory.paid')} value={sale.amountPaid} />
            <SaleValue label={t('salesHistory.refunded')} value={sale.amountRefunded} />
            <SaleValue label={t('salesHistory.balance')} value={sale.outstandingBalance} />
            {sale.notes && <SaleValue label={t('salesHistory.notes')} value={sale.notes} />}
          </Card>
          <Card className="space-y-3 p-5">
            <h2 className="font-bold text-[var(--ink)]">{t('salesHistory.items')}</h2>
            {sale.items.map((item) => (
              <div className="grid gap-1 border-b border-[var(--border)] pb-3 text-sm sm:grid-cols-4" key={item.id}>
                <span className="font-semibold">{item.productName} · {item.sku}</span>
                <span>{item.quantity} {translateMeasurementUnit(item.unitName, t)}</span>
                <span>{item.unitPrice}</span>
                <span className="font-bold">{item.lineTotal}</span>
              </div>
            ))}
          </Card>
          <Card className="space-y-3 p-5">
            <h2 className="font-bold text-[var(--ink)]">{t('salesHistory.payments')}</h2>
            {sale.payments.map((payment) => (
              <div className="flex flex-wrap justify-between gap-2 text-sm" key={payment.id}>
                <span>{t(`salesPos.methods.${payment.method}`, payment.method)}</span>
                <span>{payment.amount}</span>
                <span className="text-[var(--muted)]">{payment.reference ?? ''}</span>
              </div>
            ))}
          </Card>
          {sale.returns.length > 0 && (
            <Card className="space-y-3 p-5">
              <h2 className="font-bold text-[var(--ink)]">{t('salesReturns.previousReturns')}</h2>
              {sale.returns.map((item) => (
                <div className="border-b border-[var(--border)] pb-3" key={item.id}>
                  <p className="font-semibold">{item.returnNumber} · {item.refundTotal}</p>
                  <p className="text-sm text-[var(--muted)]">{item.reason}</p>
                  {item.items.map((line, index) => (
                    <p className="mt-1 text-sm" key={`${line.saleItemId}-${index}`}>
                      {line.productName}: {line.quantity} · {line.refundAmount}
                    </p>
                  ))}
                </div>
              ))}
            </Card>
          )}
          <div className="flex flex-wrap gap-2">
            {canReturn && ['posted', 'partially_returned'].includes(sale.status) && (
              <Button onClick={() => navigate(`/sales/returns?sale=${sale.id}`)} variant="secondary">
                {t('salesReturns.startReturn')}
              </Button>
            )}
            {canCancel && sale.status === 'posted' && (
              <Button onClick={() => void cancel()} variant="secondary">{t('salesHistory.cancelSale')}</Button>
            )}
          </div>
        </>
      )}
    </SalesPage>
  )
}

export function SalesReturnsScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { sales } = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const branchId = useWorkspaceStore((state) => state.branchId)
  const [records, setRecords] = useState<Sale[]>([])
  const [searchParams, setSearchParams] = useSearchParams()
  const saleId = searchParams.get('sale') ?? ''
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [refundAmount, setRefundAmount] = useState('')
  const [refundMethod, setRefundMethod] = useState<'cash' | 'card' | 'bank_transfer' | 'mobile'>('cash')
  const [refundReference, setRefundReference] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!user || !branchId) return
    setRecords(await sales.listSales(user.id, { branchId, limit: 100, offset: 0 }))
  }, [branchId, sales, user])
  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('salesReturns.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  const sale = records.find((item) => item.id === saleId)
  const selectedItems = sale?.items.flatMap((item) => {
    const quantity = quantities[item.id] ?? ''
    return quantity.trim() ? [{ saleItemId: item.id, quantity }] : []
  }) ?? []

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !sale || selectedItems.length === 0) return
    setBusy(true)
    setError('')
    try {
      const returnId = await sales.returnSale(user.id, sale.id, {
        reason,
        items: selectedItems,
        refundAmount: refundAmount.trim() || '0',
        ...(Number(refundAmount) > 0 ? { refundMethod, refundReference: refundReference || null } : {}),
      })
      navigate(`/sales/${sale.id}`, { replace: true, state: { returnId } })
    } catch (returnError) {
      setError(returnError instanceof Error ? returnError.message : t('salesReturns.submitFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SalesPage
      title={t('salesReturns.title')}
      description={t('salesReturns.description')}
      icon={<RotateCcw aria-hidden="true" size={22} />}
      error={error}
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="grid gap-1 text-sm font-semibold">
          {t('salesReturns.sale')}
          <select className={fieldClass} onChange={(event) => {
            setSearchParams(event.target.value ? { sale: event.target.value } : {})
            setQuantities({})
          }} required value={saleId}>
            <option value="">{t('salesReturns.chooseSale')}</option>
            {records.filter((item) => ['posted', 'partially_returned'].includes(item.status)).map((item) => (
              <option key={item.id} value={item.id}>{item.invoiceNumber} · {item.total}</option>
            ))}
          </select>
        </label>
        {sale && (
          <>
            <Card className="space-y-3 p-4">
              <h2 className="font-bold">{t('salesReturns.selectItems')}</h2>
              {sale.items.map((item) => {
                const returned = sale.returns.flatMap((record) => record.items)
                  .filter((record) => record.saleItemId === item.id)
                  .reduce((sum, record) => sum + Number(record.quantity), 0)
                const available = Math.max(0, Number(item.quantity) - returned)
                return (
                  <label className="grid items-center gap-2 text-sm sm:grid-cols-[1fr_9rem_7rem]" key={item.id}>
                    <span>{item.productName} · {item.sku} ({t('salesReturns.available')}: {available})</span>
                    <input
                      className={fieldClass}
                      max={available}
                      min="0"
                      onChange={(event) => setQuantities({ ...quantities, [item.id]: event.target.value })}
                      placeholder={t('salesReturns.returnQuantity')}
                      step="any"
                      type="number"
                      value={quantities[item.id] ?? ''}
                    />
                    <span>{translateMeasurementUnit(item.unitName, t)}</span>
                  </label>
                )
              })}
            </Card>
            <label className="grid gap-1 text-sm font-semibold">
              {t('salesReturns.reason')}
              <textarea className={`${fieldClass} min-h-20 py-2`} maxLength={500} minLength={2} onChange={(event) => setReason(event.target.value)} required value={reason} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold">
                {t('salesReturns.cashRefund')}
                <input className={fieldClass} min="0" onChange={(event) => setRefundAmount(event.target.value)} placeholder={t('salesReturns.cashRefund')} step="any" type="number" value={refundAmount} />
              </label>
              {Number(refundAmount) > 0 && (
                <>
                  <label className="grid gap-1 text-sm font-semibold">
                    {t('salesReturns.refundMethod')}
                    <select className={fieldClass} onChange={(event) => setRefundMethod(event.target.value as typeof refundMethod)} value={refundMethod}>
                      {(['cash', 'card', 'bank_transfer', 'mobile'] as const).map((method) => (
                        <option key={method} value={method}>{t(`salesPos.methods.${method}`)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
                    {t('salesReturns.reference')}
                    <input className={fieldClass} maxLength={200} onChange={(event) => setRefundReference(event.target.value)} value={refundReference} />
                  </label>
                </>
              )}
            </div>
            <Button disabled={busy || selectedItems.length === 0} type="submit">
              {busy ? t('salesReturns.processing') : t('salesReturns.submit')}
            </Button>
          </>
        )}
      </form>
    </SalesPage>
  )
}

function SalesPage({
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
      <nav aria-label={t('salesHistory.navigation')} className="flex flex-wrap gap-2">
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/pos">{t('navigation.pos')}</Link>
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/sales">{t('salesHistory.title')}</Link>
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/sales/returns">{t('salesReturns.title')}</Link>
      </nav>
      {children}
    </main>
  )
}

function SaleValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-sm font-bold text-[var(--ink)]">{value}</p>
    </div>
  )
}
