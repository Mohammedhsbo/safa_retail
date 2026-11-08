import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FilePlus2, PackageCheck, Plus, Trash2 } from 'lucide-react'
import { useRetailApplicationServices } from '../../app/RetailApplicationServices'
import { useSessionStore } from '../auth/session-store'
import { useWorkspaceStore } from '../../shared/state/workspace-store'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { ToastError } from '../../shared/components/ToastError'
import { formatLocaleDate } from '../../shared/i18n/formatDate'
import type { Purchase, Supplier } from './PurchasesService'
import type { CatalogProduct } from '../catalog/ProductCatalogService'

const fieldClass = 'min-h-11 w-full rounded-xl border border-[var(--border)] bg-white px-3 text-[var(--ink)]'

export function PurchasesScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const services = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const branchId = useWorkspaceStore((state) => state.branchId)
  const warehouseId = useWorkspaceStore((state) => state.warehouseId)
  const canCreate = Boolean(user?.permissions.includes('purchases.create'))
  const canReadProducts = Boolean(user?.permissions.includes('products.read'))
  const canManageSuppliers = Boolean(user?.permissions.includes('suppliers.manage'))
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [items, setItems] = useState<Array<{
    productId: string
    quantity: string
    unitCost: string
  }>>([{ productId: '', quantity: '1', unitCost: '' }])
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!user || !branchId) return
    const [availablePurchases, availableSuppliers, availableProducts] = await Promise.all([
      user.permissions.includes('purchases.read')
        ? services.purchases.listPurchases(user.id, { branchId, limit: 100, offset: 0 })
        : Promise.resolve([]),
      canManageSuppliers ? services.purchases.listSuppliers(user.id) : Promise.resolve([]),
      canReadProducts ? services.catalog.listProducts(user.id) : Promise.resolve([]),
    ])
    setPurchases(availablePurchases)
    setSuppliers(availableSuppliers.filter((item) => item.status === 'active'))
    setProducts(availableProducts.filter((item) => item.status === 'active'))
  }, [branchId, canManageSuppliers, canReadProducts, services, user])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('purchases.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  const create = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !warehouseId || !supplierId || !canCreate) return
    setBusy(true)
    setError('')
    try {
      const purchaseId = await services.purchases.createPurchase(user.id, {
        warehouseId,
        supplierId,
        supplierInvoiceNumber: supplierInvoiceNumber || null,
        items: items.map((item) => {
          const product = products.find((candidate) => candidate.id === item.productId)
          if (!product) throw new Error(t('purchases.chooseProduct'))
          return {
            productId: product.id,
            unitId: product.baseUnitId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            discount: '0',
          }
        }),
      })
      navigate(`/purchases/${purchaseId}`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('purchases.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PurchasePage title={t('purchases.title')} description={t('purchases.description')} icon={<FilePlus2 aria-hidden="true" size={22} />} error={error}>
      {canCreate && canReadProducts && canManageSuppliers && warehouseId && (
        <Card className="space-y-4 p-5">
          <h2 className="font-bold text-[var(--ink)]">{t('purchases.newDraft')}</h2>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void create(event)}>
            <label className="grid gap-1 text-sm font-semibold">{t('purchases.supplier')}
              <select className={fieldClass} onChange={(event) => setSupplierId(event.target.value)} required value={supplierId}>
                <option value="">{t('purchases.chooseSupplier')}</option>
                {suppliers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}
              </select>
            </label>
            <div className="grid gap-3 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-bold">{t('purchases.items')}</h3>
                <Button
                  onClick={() => setItems([...items, { productId: '', quantity: '1', unitCost: '' }])}
                  type="button"
                  variant="secondary"
                >
                  <Plus aria-hidden="true" size={18} />
                  {t('purchases.addItem')}
                </Button>
              </div>
              {items.map((item, index) => (
                <div className="grid gap-3 rounded-xl border border-[var(--border)] p-3 sm:grid-cols-[2fr_1fr_1fr_auto]" key={index}>
                  <label className="grid gap-1 text-sm font-semibold">{t('purchases.product')}
                    <select className={fieldClass} onChange={(event) => {
                      const next = [...items]
                      const nextProductId = event.target.value
                      next[index] = {
                        ...item,
                        productId: nextProductId,
                        unitCost: products.find((candidate) => candidate.id === nextProductId)?.purchasePrice ?? '',
                      }
                      setItems(next)
                    }} required value={item.productId}>
                      <option value="">{t('purchases.chooseProduct')}</option>
                      {products.filter((candidate) =>
                        candidate.id === item.productId ||
                        !items.some((other, otherIndex) =>
                          otherIndex !== index && other.productId === candidate.id,
                        ),
                      ).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.sku}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm font-semibold">{t('purchases.quantity')}
                    <input className={fieldClass} inputMode="decimal" min="0.000000001" onChange={(event) => {
                      const next = [...items]
                      next[index] = { ...item, quantity: event.target.value }
                      setItems(next)
                    }} required value={item.quantity} />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold">{t('purchases.unitCost')}
                    <input className={fieldClass} inputMode="decimal" min="0" onChange={(event) => {
                      const next = [...items]
                      next[index] = { ...item, unitCost: event.target.value }
                      setItems(next)
                    }} required value={item.unitCost} />
                  </label>
                  <Button
                    aria-label={t('purchases.removeItem')}
                    disabled={items.length === 1}
                    onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))}
                    type="button"
                    variant="secondary"
                  >
                    <Trash2 aria-hidden="true" size={18} />
                  </Button>
                </div>
              ))}
            </div>
            <label className="grid gap-1 text-sm font-semibold sm:col-span-2">{t('purchases.supplierInvoice')}
              <input className={fieldClass} maxLength={100} onChange={(event) => setSupplierInvoiceNumber(event.target.value)} value={supplierInvoiceNumber} />
            </label>
            <div className="sm:col-span-2">
              <Button disabled={busy || items.some((item) => !item.productId)}>{busy ? t('purchases.creating') : t('purchases.createDraft')}</Button>
            </div>
          </form>
        </Card>
      )}
      {!user?.permissions.includes('purchases.read') ? (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{t('purchases.readPermissionRequired')}</p>
      ) : purchases.length === 0 ? (
        <p className="rounded-xl bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t('purchases.empty')}</p>
      ) : (
        <ul className="grid gap-3">
          {purchases.map((purchase) => (
            <li key={purchase.id}>
              <Link className="grid gap-2 rounded-2xl border border-[var(--border)] bg-white p-4 hover:border-[var(--brand)] sm:grid-cols-[1fr_auto_auto]" to={`/purchases/${purchase.id}`}>
                <span>
                  <span className="block font-bold text-[var(--ink)]">{purchase.invoiceNumber}</span>
                  <span className="mt-1 block text-sm text-[var(--muted)]">{purchase.supplierName} · {formatLocaleDate(purchase.createdAt, true)}</span>
                </span>
                <span className="text-sm font-bold">{purchase.total}</span>
                <span className="text-sm text-[var(--muted)]">{t(`purchases.status.${purchase.status}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PurchasePage>
  )
}

export function PurchaseDetailsScreen() {
  const { t } = useTranslation()
  const { purchaseId } = useParams()
  const services = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const [purchase, setPurchase] = useState<Purchase | null>(null)
  const [returnReason, setReturnReason] = useState('')
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({})
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'bank_transfer' | 'mobile' | 'other'>('cash')
  const [paymentReference, setPaymentReference] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canReceive = Boolean(user?.permissions.includes('purchases.create'))
  const canPay = canReceive
  const canReturn = Boolean(user?.permissions.includes('purchases.returns'))

  const load = useCallback(async (): Promise<void> => {
    if (!user || !purchaseId) return
    setPurchase(await services.purchases.getPurchase(user.id, purchaseId))
  }, [purchaseId, services.purchases, user])
  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('purchases.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  const perform = async (action: () => Promise<void>): Promise<void> => {
    setError('')
    setBusy(true)
    try {
      await action()
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('purchases.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  const recordPayment = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !purchase) return
    await perform(async () => {
      await services.purchases.addSupplierPayment(user.id, purchase.id, {
        amount: paymentAmount,
        method: paymentMethod,
        reference: paymentReference || null,
      })
      setPaymentAmount('')
      setPaymentReference('')
    })
  }

  const recordReturn = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !purchase) return
    const items = purchase.items.flatMap((item) =>
      returnQuantities[item.id]?.trim()
        ? [{ purchaseItemId: item.id, quantity: returnQuantities[item.id]! }]
        : [],
    )
    if (items.length === 0) return
    await perform(async () => {
      await services.purchases.returnPurchase(user.id, purchase.id, {
        reason: returnReason,
        items,
      })
      setReturnReason('')
      setReturnQuantities({})
    })
  }

  return (
    <PurchasePage title={purchase?.invoiceNumber ?? t('purchases.detailsTitle')} description={purchase?.supplierName ?? ''} icon={<PackageCheck aria-hidden="true" size={22} />} error={error}>
      <Link className="text-sm font-bold text-[var(--brand)]" to="/purchases">{t('purchases.back')}</Link>
      {purchase && (
        <>
          <Card className="grid gap-3 p-5 sm:grid-cols-3">
            <PurchaseMetric label={t('purchases.supplier')} value={purchase.supplierName} />
            <PurchaseMetric label={t('purchases.statusLabel')} value={t(`purchases.status.${purchase.status}`)} />
            <PurchaseMetric label={t('purchases.total')} value={purchase.total} />
            <PurchaseMetric label={t('purchases.paid')} value={purchase.paidTotal} />
            <PurchaseMetric label={t('purchases.balance')} value={purchase.outstandingBalance} />
            <PurchaseMetric label={t('purchases.credit')} value={purchase.supplierCredit} />
          </Card>
          <Card className="space-y-3 p-5">
            <h2 className="font-bold">{t('purchases.items')}</h2>
            {purchase.items.map((item) => (
              <div className="grid gap-1 border-b border-[var(--border)] pb-3 text-sm sm:grid-cols-4" key={item.id}>
                <span className="font-semibold">{item.productName} · {item.sku}</span>
                <span>{item.quantity} {item.unitName}</span>
                <span>{item.unitCost}</span>
                <span className="font-bold">{item.lineTotal}</span>
              </div>
            ))}
          </Card>
          {canReceive && purchase.status === 'draft' && (
            <Button disabled={busy} onClick={() => {
              if (!user) return
              void perform(async () => {
                await services.purchases.receiveGoods(user.id, purchase.id)
              })
            }}>{busy ? t('purchases.processing') : t('purchases.receiveGoods')}</Button>
          )}
          {canPay && ['received', 'partially_returned', 'returned'].includes(purchase.status) && Number(purchase.outstandingBalance) > 0 && (
            <Card className="space-y-3 p-5">
              <h2 className="font-bold">{t('purchases.recordPayment')}</h2>
              <form className="grid gap-3 sm:grid-cols-3" onSubmit={(event) => void recordPayment(event)}>
                <input aria-label={t('purchases.paymentAmount')} className={fieldClass} inputMode="decimal" min="0" onChange={(event) => setPaymentAmount(event.target.value)} placeholder={t('purchases.paymentAmount')} required value={paymentAmount} />
                <select aria-label={t('purchases.paymentMethod')} className={fieldClass} onChange={(event) => {
                  const method = event.target.value
                  if (['cash', 'card', 'bank_transfer', 'mobile', 'other'].includes(method)) {
                    setPaymentMethod(method as typeof paymentMethod)
                  }
                }} value={paymentMethod}>
                  {(['cash', 'card', 'bank_transfer', 'mobile', 'other'] as const).map((method) => <option key={method} value={method}>{t(`salesPos.methods.${method}`)}</option>)}
                </select>
                <input aria-label={t('purchases.paymentReference')} className={fieldClass} maxLength={200} onChange={(event) => setPaymentReference(event.target.value)} placeholder={t('purchases.paymentReference')} value={paymentReference} />
                <Button disabled={busy} type="submit">{t('purchases.savePayment')}</Button>
              </form>
            </Card>
          )}
          {canReturn && ['received', 'partially_returned'].includes(purchase.status) && (
            <Card className="space-y-3 p-5">
              <h2 className="font-bold">{t('purchases.returnGoods')}</h2>
              <form className="space-y-3" onSubmit={(event) => void recordReturn(event)}>
                {purchase.items.map((item) => {
                  const available = Math.max(0, Number(item.quantity) - Number(item.returnedQuantity))
                  return (
                    <label className="grid items-center gap-2 text-sm sm:grid-cols-[1fr_9rem_8rem]" key={item.id}>
                      <span>{item.productName} · {item.sku} ({t('purchases.available')}: {available})</span>
                      <input className={fieldClass} inputMode="decimal" max={available} min="0" onChange={(event) => setReturnQuantities({ ...returnQuantities, [item.id]: event.target.value })} placeholder="0" step="any" type="number" value={returnQuantities[item.id] ?? ''} />
                      <span>{item.unitName}</span>
                    </label>
                  )
                })}
                <textarea aria-label={t('purchases.returnReason')} className={`${fieldClass} min-h-20 py-2`} maxLength={500} minLength={2} onChange={(event) => setReturnReason(event.target.value)} required value={returnReason} />
                <Button disabled={busy || !Object.values(returnQuantities).some((value) => value.trim())} type="submit">{t('purchases.submitReturn')}</Button>
              </form>
            </Card>
          )}
          {purchase.payments.length > 0 && (
            <Card className="space-y-3 p-5">
              <h2 className="font-bold">{t('purchases.payments')}</h2>
              {purchase.payments.map((payment) => (
                <div className="flex flex-wrap justify-between gap-2 border-b border-[var(--border)] pb-2 text-sm" key={payment.id}>
                  <span>{payment.amount}</span>
                  <span>{t(`salesPos.methods.${payment.method}`, payment.method)}</span>
                  <span>{payment.reference ?? ''}</span>
                  <span>{formatLocaleDate(payment.paidAt)}</span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </PurchasePage>
  )
}

function PurchasePage({
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
      <nav aria-label={t('purchases.navigation')} className="flex flex-wrap gap-2">
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/purchases">{t('purchases.title')}</Link>
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/suppliers">{t('parties.suppliersTitle')}</Link>
      </nav>
      {children}
    </main>
  )
}

function PurchaseMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
      <p className="mt-1 font-bold text-[var(--ink)]">{value}</p>
    </div>
  )
}
