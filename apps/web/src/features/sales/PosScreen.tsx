import { useCallback, useEffect, useMemo, useState } from 'react'
import { Printer, Search, ScanLine, ShoppingCart, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { ToastError } from '../../shared/components/ToastError'
import { translateMeasurementUnit } from '../../shared/i18n/measurementUnits'
import { isAndroidApp, shareAndroidText } from '../../infrastructure/android/androidFileService'
import {
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
} from '../inventory/decimal'
import type { Sale, SalesProduct, SalesService } from './SalesService'
import { AndroidBarcodeScanner } from './AndroidBarcodeScanner'

type CartLine = {
  product: SalesProduct
  unitId: string
  quantity: string
  unitPrice: string
  discount: string
}

type PaymentLine = {
  method: 'cash' | 'card' | 'bank_transfer' | 'mobile' | 'other'
  amount: string
  reference: string
}

type PosScreenProps = {
  salesService: Pick<
    SalesService,
    'searchProducts' | 'listCustomers' | 'getTaxConfiguration' | 'createSale' | 'getSale'
  >
  actorId: string
  branchId: string
  warehouseId: string
}

const decimalInput = /^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/

export function PosScreen({
  salesService,
  actorId,
  branchId,
  warehouseId,
}: PosScreenProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState<SalesProduct[]>([])
  const [customers, setCustomers] = useState<
    Array<{ id: string; code: string; name: string; phone: string | null }>
  >([])
  const [customerId, setCustomerId] = useState('')
  const [additionalRate, setAdditionalRate] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [payments, setPayments] = useState<PaymentLine[]>([
    { method: 'cash', amount: '', reference: '' },
  ])
  const [taxRate, setTaxRate] = useState('0')
  const [taxMode, setTaxMode] = useState<'exclusive' | 'inclusive'>('exclusive')
  const [receipt, setReceipt] = useState<Sale | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)

  const addProduct = useCallback((product: SalesProduct) => {
    setError('')
    setReceipt(null)
    const unitId = product.barcodeUnitId ?? product.baseUnitId
    const existing = cart.find((line) => line.product.id === product.id)
    if (existing) {
      if (existing.unitId !== unitId) {
        setError(t('salesPos.duplicateUnit'))
        return
      }
      setCart(cart.map((line) =>
        line.product.id === product.id
          ? { ...line, quantity: incrementDecimal(line.quantity) }
          : line,
      ))
      return
    }
    const unit = product.units.find((item) => item.id === unitId)
    if (!unit) {
      setError(t('salesPos.unitUnavailable'))
      return
    }
    setCart([...cart, {
      product,
      unitId,
      quantity: '1',
      unitPrice: formatDecimal(
        multiplyDecimal(
          parseDecimal(product.sellingPrice, 'Selling price'),
          parseDecimal(unit.factorToBase, 'Unit conversion factor'),
        ),
      ),
      discount: '',
    }])
  }, [cart, t])

  useEffect(() => {
    let active = true
    void Promise.all([
      salesService.listCustomers(actorId),
      salesService.getTaxConfiguration(actorId, branchId),
    ]).then(([customerRows, tax]) => {
      if (!active) return
      setCustomers(customerRows)
      setTaxRate(tax.taxRate)
      setTaxMode(tax.taxMode)
    }).catch((cause: unknown) => {
      if (active) {
        setError(messageOf(cause))
      }
    })
    return () => {
      active = false
    }
  }, [actorId, branchId, salesService])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      void salesService.searchProducts(actorId, {
        warehouseId,
        query,
        limit: 30,
      }).then((rows) => {
        if (!active) return
        const barcodeMatch =
          query.length > 0
            ? rows.find((product) => product.barcode === query)
            : undefined
        setProducts(rows)
        if (barcodeMatch) {
          addProduct(barcodeMatch)
          setQuery('')
        }
      }).catch((cause: unknown) => {
        if (active) setError(messageOf(cause))
      })
    }, 150)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [actorId, addProduct, query, salesService, warehouseId])

  const totals = useMemo(
    () => calculateTotals(cart, taxRate, taxMode, customerId && additionalRate.trim() ? additionalRate : '0'),
    [additionalRate, cart, customerId, taxMode, taxRate],
  )
  const paymentTotal = useMemo(() => calculatePaymentTotal(payments), [payments])
  const paymentExceedsTotal = Boolean(
    totals && paymentTotal !== null &&
    parseDecimal(paymentTotal, 'Payment total') > parseDecimal(totals.total, 'Invoice total'),
  )
  const balanceDue = totals && paymentTotal !== null &&
    parseDecimal(paymentTotal, 'Payment total') <= parseDecimal(totals.total, 'Invoice total')
    ? formatDecimal(parseDecimal(totals.total, 'Invoice total') - parseDecimal(paymentTotal, 'Payment total'))
    : null

  function updateLine(index: number, patch: Partial<CartLine>) {
    setCart(cart.map((line, lineIndex) =>
      lineIndex === index ? { ...line, ...patch } : line,
    ))
  }

  function updateUnit(index: number, unitId: string) {
    const line = cart[index]
    const unit = line?.product.units.find((item) => item.id === unitId)
    if (!line || !unit) return
    updateLine(index, {
      unitId,
      unitPrice: formatDecimal(
        multiplyDecimal(
          parseDecimal(line.product.sellingPrice, 'Selling price'),
          parseDecimal(unit.factorToBase, 'Unit conversion factor'),
        ),
      ),
    })
  }

  async function submitSale(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (cart.length === 0) {
      setError(t('salesPos.cartEmpty'))
      return
    }
    if (!totals || paymentTotal === null) {
      setError(t('salesPos.invalidSale'))
      return
    }
    if (paymentExceedsTotal) {
      setError(t('salesPos.paymentExceedsTotal'))
      return
    }
    if (parseDecimal(paymentTotal, 'Payment total') < parseDecimal(totals.total, 'Invoice total') && !customerId) {
      setError(t('salesPos.customerRequiredForBalance'))
      return
    }
    setLoading(true)
    setError('')
    try {
      const saleId = await salesService.createSale(actorId, {
        warehouseId,
        customerId: customerId || null,
        additionalRate: customerId && additionalRate.trim() ? additionalRate : '0',
        items: cart.map((line) => ({
          productId: line.product.id,
          unitId: line.unitId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount.trim() ? line.discount : '0',
        })),
        payments: payments
          .filter((payment) => payment.amount.trim().length > 0)
          .map((payment) => ({
            method: payment.method,
            amount: payment.amount,
            reference: payment.reference || null,
          })),
      })
      setReceipt(await salesService.getSale(actorId, saleId))
      setCart([])
      setPayments([{ method: 'cash', amount: '', reference: '' }])
      setCustomerId('')
      setAdditionalRate('')
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setLoading(false)
    }
  }

  async function shareReceipt() {
    if (!receipt) return
    try {
      const text = `${receipt.invoiceNumber} — ${receipt.total}`
      if (isAndroidApp()) {
        await shareAndroidText(receipt.invoiceNumber, text)
      } else if (navigator.share) {
        await navigator.share({ title: receipt.invoiceNumber, text })
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return
      setError(messageOf(cause))
    }
  }

  return (
    <main className="pos-screen min-h-screen bg-[var(--surface)] px-3 py-3 sm:px-8 sm:py-5">
      <div className="mx-auto max-w-7xl">
        <header className="mb-3 flex items-center justify-between gap-3 sm:mb-5">
          <div className="min-w-0">
            <h1 className="text-xl font-black text-[var(--ink)] sm:text-2xl">
              {t('salesPos.title')}
            </h1>
            <p className="mt-0.5 text-xs text-[var(--muted)] sm:text-sm">{t('salesPos.subtitle')}</p>
          </div>
          <span className="hidden items-center gap-2 rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--muted)] sm:inline-flex">
            <ShoppingCart aria-hidden="true" className="text-[var(--brand)]" size={16} />
            {t('salesPos.cart')}
          </span>
        </header>

        {error && (
          <>
          <ToastError error={error} />
          <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </p>
          </>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-[1.1fr_0.9fr] lg:gap-6">
          <Card className="min-w-0 p-4 sm:p-6">
            <label className="mb-4 block text-sm font-bold text-[var(--ink)]" htmlFor="pos-product-search">
              {t('salesPos.search')}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search aria-hidden="true" className="absolute start-3 top-3.5 text-[var(--muted)]" size={18} />
                <input
                  autoComplete="off"
                  className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-white ps-10 pe-4 text-[var(--ink)] outline-none focus:border-[var(--brand)]"
                  id="pos-product-search"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('salesPos.searchPlaceholder')}
                  value={query}
                />
              </div>
              {isAndroidApp() && (
                <Button
                  aria-label={t('salesPos.scanBarcode')}
                  onClick={() => setScannerOpen(true)}
                  variant="secondary"
                >
                  <ScanLine aria-hidden="true" size={18} />
                  {t('salesPos.scanBarcode')}
                </Button>
              )}
            </div>
            <ul className="mt-4 grid max-h-[45vh] gap-3 overflow-y-auto sm:max-h-[60vh] sm:grid-cols-2" aria-label={t('salesPos.products')}>
              {products.map((product) => (
                <li key={product.id}>
                  <button
                    className="w-full rounded-2xl border border-[var(--border)] bg-white p-3 text-start transition hover:border-[var(--brand-border)] hover:bg-[var(--brand-wash)] focus-visible:outline-2 focus-visible:outline-[var(--brand)] sm:p-4"
                    onClick={() => addProduct(product)}
                    type="button"
                  >
                    <span className="block font-bold text-[var(--ink)]">{product.name}</span>
                    <span className="mt-1 block text-sm text-[var(--muted)]">
                      {product.sku} · {translateMeasurementUnit(product.baseUnitName, t)}
                    </span>
                    <span className="mt-2 block text-sm font-bold text-[var(--brand)]">
                      {product.sellingPrice} · {t('salesPos.stock')}: {product.stock}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <form onSubmit={submitSale}>
            <Card className="min-w-0 p-4 sm:p-6">
              <h2 className="text-lg font-extrabold text-[var(--ink)]">{t('salesPos.cart')}</h2>
              {cart.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--muted)]">{t('salesPos.cartEmpty')}</p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {cart.map((line, index) => (
                    <li className="rounded-2xl border border-[var(--border)] p-4" key={line.product.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold text-[var(--ink)]">{line.product.name}</p>
                          <p className="text-xs text-[var(--muted)]">{line.product.sku}</p>
                        </div>
                        <button
                          aria-label={`${t('salesPos.remove')} ${line.product.name}`}
                          className="rounded-lg p-2 text-red-700 hover:bg-red-50"
                          onClick={() => setCart(cart.filter((_, itemIndex) => itemIndex !== index))}
                          type="button"
                        >
                          <Trash2 aria-hidden="true" size={18} />
                        </button>
                      </div>
                      <div className="mt-4 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
                        <label className="text-xs font-semibold text-[var(--muted)]">
                          {t('salesPos.unit')}
                          <select
                            className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border)] bg-white px-2 text-sm text-[var(--ink)]"
                            onChange={(event) => updateUnit(index, event.target.value)}
                            value={line.unitId}
                          >
                            {line.product.units.map((unit) => (
                              <option key={unit.id} value={unit.id}>{translateMeasurementUnit(unit.name, t)}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-semibold text-[var(--muted)]">
                          {t('salesPos.quantity')}
                          <input
                            className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border)] px-2 text-sm text-[var(--ink)]"
                            min="0"
                            onChange={(event) => updateLine(index, { quantity: event.target.value })}
                            step="any"
                            type="number"
                            value={line.quantity}
                          />
                        </label>
                        <label className="text-xs font-semibold text-[var(--muted)]">
                          {t('salesPos.unitPrice')}
                          <input
                            className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border)] px-2 text-sm text-[var(--ink)]"
                            min="0"
                            onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
                            step="any"
                            type="number"
                            value={line.unitPrice}
                          />
                        </label>
                        <label className="text-xs font-semibold text-[var(--muted)]">
                          {t('salesPos.discount')}
                          <input
                            className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border)] px-2 text-sm text-[var(--ink)]"
                            min="0"
                            onChange={(event) => updateLine(index, { discount: event.target.value })}
                            step="any"
                            type="number"
                            value={line.discount}
                          />
                        </label>
                      </div>
                      <p className="mt-3 text-end text-sm font-bold text-[var(--ink)]">
                        {t('salesPos.lineTotal')}: {lineAmount(line, taxRate, taxMode) ?? '—'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              <label className="mt-5 block text-sm font-bold text-[var(--ink)]">
                {t('salesPos.customer')}
                <select
                  className="mt-2 min-h-11 w-full rounded-xl border border-[var(--border)] bg-white px-3 font-normal"
                  onChange={(event) => {
                    const nextCustomerId = event.target.value
                    setCustomerId(nextCustomerId)
                    if (!nextCustomerId) {
                      setAdditionalRate('')
                      if (payments.length > 1) {
                        setPayments([{
                          method: 'cash',
                          amount: paymentTotal ?? '',
                          reference: '',
                        }])
                      }
                    }
                  }}
                  value={customerId}
                >
                  <option value="">{t('salesPos.walkIn')}</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}{customer.phone ? ` · ${customer.phone}` : ''}
                    </option>
                  ))}
                </select>
              </label>

              {customerId && (
                <label className="mt-4 grid gap-1 text-sm font-bold text-[var(--ink)]">
                  {t('salesPos.additionalRate')}
                  <input
                    className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-white px-3 font-normal"
                    max="100"
                    min="0"
                    onChange={(event) => setAdditionalRate(event.target.value)}
                    placeholder={t('salesPos.additionalRate')}
                    step="any"
                    type="number"
                    value={additionalRate}
                  />
                </label>
              )}

              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-bold text-[var(--ink)]">{t('salesPos.payments')}</h3>
                  {customerId && (
                    <button
                      className="text-sm font-bold text-[var(--brand)]"
                      onClick={() => setPayments([...payments, { method: 'cash', amount: '', reference: '' }])}
                      type="button"
                    >
                      {t('salesPos.addPayment')}
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {payments.map((payment, index) => (
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2" key={index}>
                      {customerId ? (
                        <select
                          aria-label={t('salesPos.paymentMethod')}
                          className="min-h-10 min-w-0 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
                          onChange={(event) => {
                            const method = paymentMethod(event.target.value)
                            if (method) {
                              updatePayment(setPayments, payments, index, { method })
                            }
                          }}
                          value={payment.method}
                        >
                          {(['cash', 'card', 'bank_transfer', 'mobile', 'other'] as const).map((method) => (
                            <option key={method} value={method}>{t(`salesPos.methods.${method}`)}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="flex min-w-0 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs font-semibold text-[var(--muted)]">
                          {t('salesPos.methods.cash')}
                        </span>
                      )}
                      <input
                        aria-label={t('salesPos.paymentAmount')}
                        className="min-h-10 rounded-lg border border-[var(--border)] px-2 text-sm"
                        min="0"
                        onChange={(event) => updatePayment(setPayments, payments, index, { amount: event.target.value })}
                        placeholder={t('salesPos.paymentAmount')}
                        step="any"
                        type="number"
                        value={payment.amount}
                      />
                      {customerId && (
                        <button
                          aria-label={t('salesPos.removePayment')}
                          className="rounded-lg px-2 text-red-700 hover:bg-red-50"
                          onClick={() => setPayments(payments.filter((_, itemIndex) => itemIndex !== index))}
                          type="button"
                        >
                          <Trash2 aria-hidden="true" size={17} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm text-[var(--muted)]">
                  {t('salesPos.paid')}: {paymentTotal ?? '—'}
                  {balanceDue !== null && ` · ${t('salesPos.balanceDue')}: ${balanceDue}`}
                </p>
                {paymentExceedsTotal && (
                  <p className="mt-2 text-sm text-red-700" role="alert">{t('salesPos.paymentExceedsTotal')}</p>
                )}
                {paymentTotal === null && (
                  <p className="mt-2 text-sm text-red-700" role="alert">{t('salesPos.invalidPayment')}</p>
                )}
                {balanceDue !== null && parseDecimal(balanceDue, 'Balance due') > 0n && !customerId && (
                  <p className="mt-2 text-sm text-amber-800">{t('salesPos.customerRequiredForBalance')}</p>
                )}
                {scannerOpen && (
                  <AndroidBarcodeScanner
                    onBarcode={(value) => {
                      setQuery(value)
                      setError('')
                    }}
                    onClose={() => setScannerOpen(false)}
                    onError={setError}
                  />
                )}
              </div>

              <dl className="mt-5 space-y-2 border-t border-[var(--border)] pt-4 text-sm">
                <div className="flex justify-between"><dt>{t('salesPos.subtotal')}</dt><dd>{totals?.subtotal ?? '—'}</dd></div>
                <div className="flex justify-between"><dt>{t('salesPos.discount')}</dt><dd>{totals?.discount ?? '—'}</dd></div>
                {totals && parseDecimal(totals.additionalTotal, 'Additional amount') > 0n && (
                  <div className="flex justify-between"><dt>{t('salesPos.additionalAmount')} ({totals.additionalRate}%)</dt><dd>{totals.additionalTotal}</dd></div>
                )}
                {totals && parseDecimal(totals.tax, 'Tax total') > 0n && (
                  <div className="flex justify-between"><dt>{t('salesPos.tax')}</dt><dd>{totals.tax}</dd></div>
                )}
                <div className="flex justify-between text-lg font-black text-[var(--ink)]"><dt>{t('salesPos.total')}</dt><dd>{totals?.total ?? '—'}</dd></div>
              </dl>
              {cart.length > 0 && !totals && (
                <p className="mt-3 text-sm text-red-700" role="alert">
                  {cartExceedsStock(cart) ? t('salesPos.stockExceeded') : t('salesPos.invalidSale')}
                </p>
              )}
              <Button
                className="mt-5 w-full"
                disabled={loading || cart.length === 0 || !totals || paymentTotal === null || paymentExceedsTotal || (!customerId && balanceDue !== null && parseDecimal(balanceDue, 'Balance due') > 0n)}
                type="submit"
              >
                {loading ? t('salesPos.processing') : t('salesPos.confirm')}
              </Button>
            </Card>
          </form>
        </div>

        {receipt && (
          <Card className="pos-receipt-card mt-6 p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-[var(--brand)]">{t('salesPos.completed')}</p>
                <h2 className="text-xl font-black text-[var(--ink)]">{receipt.invoiceNumber}</h2>
                <p className="text-sm text-[var(--muted)]">
                  {t('salesPos.total')}: {receipt.total} · {t('salesPos.balanceDue')}: {receipt.outstandingBalance} · {t('salesPos.customerCredit')}: {receipt.customerCredit}
                </p>
              </div>
              <div className="flex gap-2">
                <Button className="print:hidden" onClick={() => window.print()} variant="secondary">
                  <Printer aria-hidden="true" size={17} /> {t('salesPos.print')}
                </Button>
                {typeof navigator.share === 'function' && (
                  <Button className="print:hidden" onClick={() => void shareReceipt()} variant="secondary">
                    {t('salesPos.share')}
                  </Button>
                )}
              </div>
            </div>
            <section aria-label={t('salesPos.printReceipt')} className="pos-print-receipt mt-5 border-t border-dashed border-[var(--border)] pt-4">
              <header className="text-center">
                <h2 className="text-2xl font-black">{t('salesPos.storeName')}</h2>
                <p className="mt-2 text-sm">{t('salesPos.invoiceNumber')}: {receipt.invoiceNumber}</p>
                <p className="text-sm">{new Date(receipt.createdAt).toLocaleString()}</p>
                <p className="text-sm">{t('salesPos.customer')}: {receipt.customerName ?? t('salesPos.walkIn')}</p>
              </header>
              <table className="mt-5 w-full border-collapse text-start text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="py-2 text-start">{t('salesPos.product')}</th>
                    <th className="px-2 py-2 text-end">{t('salesPos.quantity')}</th>
                    <th className="py-2 text-end">{t('salesPos.lineTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map((item) => (
                    <tr className="border-b border-[var(--border)]" key={item.id}>
                      <td className="py-2">{item.productName}</td>
                      <td className="px-2 py-2 text-end">{item.quantity} {translateMeasurementUnit(item.unitName, t)}</td>
                      <td className="py-2 text-end">{item.lineTotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="ms-auto mt-4 grid max-w-sm gap-2 text-sm">
                <div className="flex justify-between"><dt>{t('salesPos.subtotal')}</dt><dd>{receipt.subtotal}</dd></div>
                <div className="flex justify-between"><dt>{t('salesPos.discount')}</dt><dd>{receipt.discountTotal}</dd></div>
                {parseDecimal(receipt.additionalTotal, 'Additional amount') > 0n && <div className="flex justify-between"><dt>{t('salesPos.additionalAmount')} ({receipt.additionalRate}%)</dt><dd>{receipt.additionalTotal}</dd></div>}
                {parseDecimal(receipt.taxTotal, 'Tax total') > 0n && <div className="flex justify-between"><dt>{t('salesPos.tax')}</dt><dd>{receipt.taxTotal}</dd></div>}
                <div className="flex justify-between border-t border-[var(--border)] pt-2 text-base font-black"><dt>{t('salesPos.total')}</dt><dd>{receipt.total}</dd></div>
                <div className="flex justify-between"><dt>{t('salesPos.paid')}</dt><dd>{receipt.amountPaid}</dd></div>
                <div className="flex justify-between"><dt>{t('salesPos.balanceDue')}</dt><dd>{receipt.outstandingBalance}</dd></div>
              </dl>
              <p className="mt-6 text-center text-sm">{t('salesPos.thankYou')}</p>
            </section>
          </Card>
        )}
      </div>
    </main>
  )
}

function calculateTotals(
  cart: CartLine[],
  taxRateText: string,
  taxMode: 'exclusive' | 'inclusive',
  additionalRateText = '0',
): { subtotal: string; discount: string; additionalRate: string; additionalTotal: string; tax: string; total: string } | null {
  if (!decimalInput.test(taxRateText) || !decimalInput.test(additionalRateText)) return null
  const additionalRate = parseDecimal(additionalRateText, 'Additional rate')
  if (additionalRate > parseDecimal('100', 'Maximum additional rate')) return null
  let subtotal = 0n
  let discountTotal = 0n
  let tax = 0n
  let total = 0n
  for (const line of cart) {
    const discountText = line.discount.trim() ? line.discount : '0'
    if (
      !decimalInput.test(line.quantity) ||
      !decimalInput.test(line.unitPrice) ||
      !decimalInput.test(discountText)
    ) return null
    if (parseDecimal(line.quantity, 'Quantity') <= 0n) return null
    const unit = line.product.units.find((item) => item.id === line.unitId)
    const baseUnit = line.product.units.find((item) => item.id === line.product.baseUnitId)
    if (!unit || !baseUnit ||
      decimalPlaces(line.quantity) > unit.decimalPlaces) return null
    const baseQuantity = multiplyDecimal(
      parseDecimal(line.quantity, 'Quantity'),
      parseDecimal(unit.factorToBase, 'Unit conversion factor'),
    )
    if (
      decimalPlaces(formatDecimal(baseQuantity)) > baseUnit.decimalPlaces ||
      baseQuantity > parseDecimal(line.product.stock, 'Available stock')
    ) return null
    const gross = multiplyDecimal(
      parseDecimal(line.quantity, 'Quantity'),
      parseDecimal(line.unitPrice, 'Unit price'),
    )
    const discount = parseDecimal(discountText, 'Discount')
    if (discount > gross) return null
    const taxable = gross - discount
    const rate = parseDecimal(taxRateText, 'Tax rate')
    const lineTax = taxMode === 'inclusive'
      ? divideDecimal(
          multiplyDecimal(taxable, rate),
          parseDecimal('100', 'Percentage base') + rate,
        )
      : divideDecimal(
          multiplyDecimal(taxable, rate),
          parseDecimal('100', 'Percentage base'),
        )
    subtotal += gross
    discountTotal += discount
    tax += lineTax
    total += taxMode === 'inclusive' ? taxable : taxable + lineTax
  }
  const netSubtotal = subtotal - discountTotal
  const additional = divideDecimal(
    multiplyDecimal(netSubtotal, additionalRate),
    parseDecimal('100', 'Percentage base'),
  )
  const rate = parseDecimal(taxRateText, 'Tax rate')
  const additionalTax = taxMode === 'inclusive'
    ? divideDecimal(
        multiplyDecimal(additional, rate),
        parseDecimal('100', 'Percentage base') + rate,
      )
    : divideDecimal(
        multiplyDecimal(additional, rate),
        parseDecimal('100', 'Percentage base'),
      )
  tax += additionalTax
  total += taxMode === 'inclusive' ? additional : additional + additionalTax
  return {
    subtotal: formatDecimal(subtotal),
    discount: formatDecimal(discountTotal),
    additionalRate: formatDecimal(additionalRate),
    additionalTotal: formatDecimal(additional),
    tax: formatDecimal(tax),
    total: formatDecimal(total),
  }
}

function lineAmount(
  line: CartLine,
  taxRateText: string,
  taxMode: 'exclusive' | 'inclusive',
): string | null {
  const discountText = line.discount.trim() ? line.discount : '0'
  if (!decimalInput.test(line.quantity) || !decimalInput.test(line.unitPrice) || !decimalInput.test(discountText)) {
    return null
  }
  const gross = multiplyDecimal(
    parseDecimal(line.quantity, 'Quantity'),
    parseDecimal(line.unitPrice, 'Unit price'),
  )
  const discount = parseDecimal(discountText, 'Discount')
  if (!decimalInput.test(taxRateText) || discount > gross) return null
  const taxable = gross - discount
  const rate = parseDecimal(taxRateText, 'Tax rate')
  if (taxMode === 'inclusive') return formatDecimal(taxable)
  return formatDecimal(taxable + divideDecimal(
    multiplyDecimal(taxable, rate),
    parseDecimal('100', 'Percentage base'),
  ))
}

function decimalPlaces(value: string): number {
  return value.split('.')[1]?.length ?? 0
}

function calculatePaymentTotal(payments: PaymentLine[]): string | null {
  let total = 0n
  for (const payment of payments) {
    if (!payment.amount.trim()) continue
    if (!decimalInput.test(payment.amount)) return null
    total += parseDecimal(payment.amount, 'Payment amount')
  }
  return formatDecimal(total)
}

function cartExceedsStock(cart: CartLine[]): boolean {
  return cart.some((line) => {
    if (!decimalInput.test(line.quantity)) return false
    const unit = line.product.units.find((item) => item.id === line.unitId)
    if (!unit) return false
    return multiplyDecimal(
      parseDecimal(line.quantity, 'Quantity'),
      parseDecimal(unit.factorToBase, 'Unit conversion factor'),
    ) > parseDecimal(line.product.stock, 'Available stock')
  })
}

function incrementDecimal(value: string): string {
  if (!decimalInput.test(value)) return '1'
  return formatDecimal(parseDecimal(value, 'Quantity') + parseDecimal('1', 'Quantity'))
}

function updatePayment(
  setPayments: React.Dispatch<React.SetStateAction<PaymentLine[]>>,
  payments: PaymentLine[],
  index: number,
  patch: Partial<PaymentLine>,
) {
  setPayments(payments.map((payment, paymentIndex) =>
    paymentIndex === index ? { ...payment, ...patch } : payment,
  ))
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The sales operation failed'
}

function paymentMethod(value: string): PaymentLine['method'] | null {
  if (
    value === 'cash' ||
    value === 'card' ||
    value === 'bank_transfer' ||
    value === 'mobile' ||
    value === 'other'
  ) {
    return value
  }
  return null
}
