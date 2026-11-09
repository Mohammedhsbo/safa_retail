import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ClipboardCheck, Boxes, Warehouse } from 'lucide-react'
import { useRetailApplicationServices } from '../../app/RetailApplicationServices'
import { useSessionStore } from '../auth/session-store'
import { useWorkspaceStore } from '../../shared/state/workspace-store'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { ToastError } from '../../shared/components/ToastError'
import { formatLocaleDate } from '../../shared/i18n/formatDate'
import type { InventoryBalance, StockCount, StockTransfer } from './InventoryService'
import type { CatalogProduct } from '../catalog/ProductCatalogService'

const fieldClass = 'min-h-11 w-full rounded-xl border border-[var(--border)] bg-white px-3 text-[var(--ink)]'

export function InventoryScreen() {
  const { t } = useTranslation()
  const services = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const warehouseId = useWorkspaceStore((state) => state.warehouseId)
  const canAdjust = Boolean(user?.permissions.includes('inventory.adjust'))
  const [balances, setBalances] = useState<InventoryBalance[]>([])
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [query, setQuery] = useState('')
  const [productId, setProductId] = useState('')
  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [reasonType, setReasonType] = useState<'correction' | 'damage' | 'missing'>('correction')
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    if (!user || !warehouseId) return
    const [availableBalances, availableProducts] = await Promise.all([
      services.inventory.listBalances(user.id, warehouseId),
      user.permissions.includes('products.read')
        ? services.catalog.listProducts(user.id)
        : Promise.resolve([]),
    ])
    setBalances(availableBalances)
    setProducts(availableProducts.filter((item) => item.status === 'active'))
  }, [services, user, warehouseId])
  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('inventory.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  const adjust = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !warehouseId) return
    const product = products.find((item) => item.id === productId)
    if (!product) return
    setError('')
    try {
      await services.inventory.adjustStock(user.id, {
        productId,
        warehouseId,
        unitId: product.baseUnitId,
        quantity,
        direction,
        reasonType,
        ...(direction === 'in' ? { unitCost } : {}),
        reason,
      })
      setQuantity('')
      setUnitCost('')
      setReason('')
      await load()
    } catch (adjustError) {
      setError(adjustError instanceof Error ? adjustError.message : t('inventory.adjustFailed'))
    }
  }

  const filtered = balances.filter((item) =>
    `${item.productName} ${item.sku}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )

  return (
    <InventoryPage title={t('inventory.title')} description={t('inventory.description')} icon={<Boxes aria-hidden="true" size={22} />} error={error}>
      <label className="grid gap-1 text-sm font-semibold">
        {t('inventory.search')}
        <input className={fieldClass} onChange={(event) => setQuery(event.target.value)} value={query} />
      </label>
      {canAdjust && products.length > 0 && (
        <Card className="space-y-3 p-5">
          <h2 className="font-bold">{t('inventory.adjustTitle')}</h2>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void adjust(event)}>
            <label className="grid gap-1 text-sm font-semibold">{t('inventory.product')}
              <select className={fieldClass} onChange={(event) => setProductId(event.target.value)} required value={productId}>
                <option value="">{t('inventory.chooseProduct')}</option>
                {products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">{t('inventory.direction')}
              <select className={fieldClass} onChange={(event) => {
                if (event.target.value === 'in' || event.target.value === 'out') setDirection(event.target.value)
              }} value={direction}>
                <option value="in">{t('inventory.in')}</option>
                <option value="out">{t('inventory.out')}</option>
              </select>
            </label>
            {direction === 'out' && (
              <label className="grid gap-1 text-sm font-semibold">{t('inventory.reasonType')}
                <select className={fieldClass} onChange={(event) => {
                  if (['correction', 'damage', 'missing'].includes(event.target.value)) {
                    setReasonType(event.target.value as typeof reasonType)
                  }
                }} value={reasonType}>
                  {(['correction', 'damage', 'missing'] as const).map((value) => <option key={value} value={value}>{t(`inventory.reasonTypes.${value}`)}</option>)}
                </select>
              </label>
            )}
            <label className="grid gap-1 text-sm font-semibold">{t('inventory.quantity')}
              <input className={fieldClass} inputMode="decimal" min="0.000000001" onChange={(event) => setQuantity(event.target.value)} required value={quantity} />
            </label>
            {direction === 'in' && (
              <label className="grid gap-1 text-sm font-semibold">{t('inventory.unitCost')}
                <input className={fieldClass} inputMode="decimal" min="0" onChange={(event) => setUnitCost(event.target.value)} required value={unitCost} />
              </label>
            )}
            <label className="grid gap-1 text-sm font-semibold sm:col-span-2">{t('inventory.reason')}
              <textarea className={`${fieldClass} min-h-20 py-2`} maxLength={500} minLength={2} onChange={(event) => setReason(event.target.value)} required value={reason} />
            </label>
            <Button type="submit">{t('inventory.recordAdjustment')}</Button>
          </form>
        </Card>
      )}
      <div className="grid gap-3">
        {filtered.length === 0 ? (
          <p className="rounded-xl bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t('inventory.empty')}</p>
        ) : filtered.map((item) => (
          <Card className="grid gap-2 p-4 sm:grid-cols-[1fr_auto_auto_auto]" key={item.productId}>
            <div>
              <p className="font-bold text-[var(--ink)]">{item.productName}</p>
              <p className="text-sm text-[var(--muted)]">{item.sku}</p>
            </div>
            <InventoryValue label={t('inventory.quantity')} value={item.quantity} />
            <InventoryValue label={t('inventory.averageCost')} value={item.averageUnitCost} />
            <InventoryValue label={t('inventory.value')} value={item.inventoryValue} />
          </Card>
        ))}
      </div>
    </InventoryPage>
  )
}

export function WarehouseDetailsScreen() {
  const { t } = useTranslation()
  const { warehouseId: routeWarehouseId } = useParams()
  const services = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const selectedWarehouseId = useWorkspaceStore((state) => state.warehouseId)
  const warehouseId = routeWarehouseId ?? selectedWarehouseId
  const branchId = useWorkspaceStore((state) => state.branchId)
  const [warehouseName, setWarehouseName] = useState('')
  const [balances, setBalances] = useState<InventoryBalance[]>([])
  const [movements, setMovements] = useState<Array<{
    id: string; productName: string; movementType: string; quantity: string; occurredAt: string
  }>>([])
  const [totalValue, setTotalValue] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    if (!user || !warehouseId || !branchId) return
    const load = async (): Promise<void> => {
      const [warehouses, availableBalances, valuation, history] = await Promise.all([
        services.organization.listAccessibleWarehouses(user.id, branchId),
        services.inventory.listBalances(user.id, warehouseId),
        services.inventory.getValuation(user.id, warehouseId),
        services.inventory.listMovements(user.id, { warehouseId, limit: 50, offset: 0 }),
      ])
      if (!active) return
      setWarehouseName(warehouses.find((item) => item.id === warehouseId)?.name ?? '')
      setBalances(availableBalances)
      setTotalValue(valuation.totalValue)
      setMovements(history)
    }
    void load().catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('inventory.loadFailed'))
    })
    return () => { active = false }
  }, [branchId, services, t, user, warehouseId])

  return (
    <InventoryPage title={warehouseName || t('inventory.warehouseDetails')} description={t('inventory.warehouseDescription')} icon={<Warehouse aria-hidden="true" size={22} />} error={error}>
      <Link className="text-sm font-bold text-[var(--brand)]" to="/inventory">{t('inventory.backToInventory')}</Link>
      <div className="grid gap-3 sm:grid-cols-2">
        <InventoryMetric label={t('inventory.productsInStock')} value={String(balances.length)} />
        <InventoryMetric label={t('inventory.totalValue')} value={totalValue} />
      </div>
      <Card className="space-y-3 p-5">
        <h2 className="font-bold">{t('inventory.movements')}</h2>
        {movements.length === 0 ? <p className="text-sm text-[var(--muted)]">{t('inventory.noMovements')}</p> : movements.map((movement) => (
          <div className="grid gap-1 border-b border-[var(--border)] pb-3 text-sm sm:grid-cols-4" key={movement.id}>
            <span className="font-semibold">{movement.productName}</span>
            <span>{t(`inventory.movementTypes.${movement.movementType}`, movement.movementType)}</span>
            <span>{movement.quantity}</span>
            <span>{formatLocaleDate(movement.occurredAt, true)}</span>
          </div>
        ))}
      </Card>
    </InventoryPage>
  )
}

export function StocktakingScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { countId } = useParams()
  const services = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const warehouseId = useWorkspaceStore((state) => state.warehouseId)
  const canCount = Boolean(user?.permissions.includes('inventory.count'))
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [counts, setCounts] = useState<StockCount[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [count, setCount] = useState<StockCount | null>(null)
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!user || !warehouseId) return
    const [availableCounts, availableProducts] = await Promise.all([
      services.inventory.listStockCounts(user.id, warehouseId),
      user.permissions.includes('products.read') ? services.catalog.listProducts(user.id) : Promise.resolve([]),
    ])
    setCounts(availableCounts)
    setProducts(availableProducts.filter((item) => item.status === 'active'))
  }, [services, user, warehouseId])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('inventory.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  useEffect(() => {
    let active = true
    if (!user || !countId) {
      void Promise.resolve().then(() => {
        if (active) setCount(null)
      })
      return () => { active = false }
    }
    void services.inventory.getStockCount(user.id, countId).then((result) => {
      if (active) setCount(result)
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('inventory.countLoadFailed'))
    })
    return () => { active = false }
  }, [countId, services.inventory, t, user])

  const create = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !warehouseId || selectedIds.length === 0) return
    setBusy(true)
    setError('')
    try {
      const id = await services.inventory.createStockCount(user.id, { warehouseId, productIds: selectedIds })
      navigate(`/inventory/counts/${id}`)
      await load()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('inventory.countCreateFailed'))
    } finally {
      setBusy(false)
    }
  }

  const perform = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
      if (user && countId) setCount(await services.inventory.getStockCount(user.id, countId))
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('inventory.countActionFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <InventoryPage title={t('inventory.stocktakingTitle')} description={t('inventory.stocktakingDescription')} icon={<ClipboardCheck aria-hidden="true" size={22} />} error={error}>
      {!count && canCount && !countId && (
        <Card className="space-y-3 p-5">
          <h2 className="font-bold">{t('inventory.createCount')}</h2>
          <form className="space-y-3" onSubmit={(event) => void create(event)}>
            <div className="grid gap-2 sm:grid-cols-2">
              {products.map((product) => (
                <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-3 text-sm" key={product.id}>
                  <input checked={selectedIds.includes(product.id)} onChange={(event) => setSelectedIds(event.target.checked ? [...selectedIds, product.id] : selectedIds.filter((id) => id !== product.id))} type="checkbox" />
                  {product.name} · {product.sku}
                </label>
              ))}
            </div>
            <Button disabled={busy || selectedIds.length === 0}>{t('inventory.createCount')}</Button>
          </form>
        </Card>
      )}
      {count ? (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold">{count.countNumber}</h2>
              <p className="text-sm text-[var(--muted)]">{t(`inventory.countStatus.${count.status}`, count.status)}</p>
            </div>
            {count.status === 'draft' && <Button disabled={busy} onClick={() => {
              if (!user) return
              void perform(() => services.inventory.startStockCount(user.id, count.id))
            }}>{t('inventory.startCount')}</Button>}
            {count.status === 'counting' && <Button disabled={busy || count.items.some((item) => item.countedQuantity === null)} onClick={() => {
              if (!user) return
              void perform(() => services.inventory.approveStockCount(user.id, count.id))
            }}>{t('inventory.approveCount')}</Button>}
          </div>
          {count.items.map((item) => {
            const product = products.find((candidate) => candidate.id === item.productId)
            return (
              <div className="grid items-center gap-2 border-t border-[var(--border)] pt-3 sm:grid-cols-[1fr_auto_12rem]" key={item.id}>
                <span className="font-semibold">{product?.name ?? item.productId}</span>
                <span className="text-sm text-[var(--muted)]">{t('inventory.expected')}: {item.expectedQuantity}</span>
                {count.status === 'counting' ? (
                  <form className="flex gap-2" onSubmit={(event) => {
                    event.preventDefault()
                    if (!user) return
                    void perform(() => services.inventory.recordStockCount(user.id, count.id, {
                      productId: item.productId,
                      unitId: item.unitId,
                      countedQuantity: quantities[item.productId] ?? item.countedQuantity ?? '',
                    }))
                  }}>
                    <input aria-label={t('inventory.countedQuantity')} className={fieldClass} inputMode="decimal" min="0" onChange={(event) => setQuantities({ ...quantities, [item.productId]: event.target.value })} required value={quantities[item.productId] ?? item.countedQuantity ?? ''} />
                    <Button type="submit">{t('inventory.recordCount')}</Button>
                  </form>
                ) : <span>{item.countedQuantity ?? '—'}</span>}
              </div>
            )
          })}
        </Card>
      ) : (
        <ul className="grid gap-3">
          {counts.map((item) => (
            <li key={item.id}><Link className="flex justify-between rounded-xl border border-[var(--border)] bg-white p-4" to={`/inventory/counts/${item.id}`}><span>{item.countNumber}</span><span>{t(`inventory.countStatus.${item.status}`, item.status)}</span></Link></li>
          ))}
        </ul>
      )}
    </InventoryPage>
  )
}

export function StockTransfersScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { transferId } = useParams()
  const services = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const sourceWarehouseId = useWorkspaceStore((state) => state.warehouseId)
  const [transfers, setTransfers] = useState<StockTransfer[]>([])
  const [transfer, setTransfer] = useState<StockTransfer | null>(null)
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; branchId: string }>>([])
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [destinationId, setDestinationId] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<Array<{ productId: string; quantity: string }>>([{ productId: '', quantity: '1' }])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canTransfer = Boolean(user?.permissions.includes('inventory.transfer'))

  const load = useCallback(async (): Promise<void> => {
    if (!user || !sourceWarehouseId || !canTransfer) return
    const [availableTransfers, availableBranches, availableProducts] = await Promise.all([
      services.inventory.listTransfers(user.id, sourceWarehouseId),
      services.organization.listAccessibleBranches(user.id),
      user.permissions.includes('products.read') ? services.catalog.listProducts(user.id) : Promise.resolve([]),
    ])
    const accessibleWarehouses = await Promise.all(
      availableBranches.map((branch) =>
        services.organization.listAccessibleWarehouses(user.id, branch.id),
      ),
    )
    setTransfers(availableTransfers)
    setWarehouses(accessibleWarehouses.flat().map((warehouse) => ({
      id: warehouse.id,
      name: warehouse.name,
      branchId: warehouse.branchId,
    })).filter((warehouse) => warehouse.id !== sourceWarehouseId))
    setProducts(availableProducts.filter((product) => product.status === 'active'))
  }, [canTransfer, services, sourceWarehouseId, user])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('inventory.transferLoadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  useEffect(() => {
    let active = true
    if (!user || !transferId || !canTransfer) {
      void Promise.resolve().then(() => {
        if (active) setTransfer(null)
      })
      return () => { active = false }
    }
    void services.inventory.getTransfer(user.id, transferId).then((result) => {
      if (active) setTransfer(result)
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('inventory.transferLoadFailed'))
    })
    return () => { active = false }
  }, [canTransfer, services.inventory, t, transferId, user])

  const create = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !sourceWarehouseId || !destinationId) return
    setBusy(true)
    setError('')
    try {
      const id = await services.inventory.createTransfer(user.id, {
        fromWarehouseId: sourceWarehouseId,
        toWarehouseId: destinationId,
        notes: notes || null,
        items: items.map((item) => {
          const product = products.find((candidate) => candidate.id === item.productId)
          if (!product) throw new Error(t('inventory.chooseProduct'))
          return { productId: product.id, unitId: product.baseUnitId, quantity: item.quantity }
        }),
      })
      navigate(`/inventory/transfers/${id}`)
      await load()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('inventory.transferCreateFailed'))
    } finally {
      setBusy(false)
    }
  }

  const perform = async (action: (id: string) => Promise<void>): Promise<void> => {
    if (!user || !transfer) return
    setBusy(true)
    setError('')
    try {
      await action(transfer.id)
      setTransfer(await services.inventory.getTransfer(user.id, transfer.id))
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('inventory.transferActionFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <InventoryPage title={t('inventory.transfersTitle')} description={t('inventory.transfersDescription')} icon={<Boxes aria-hidden="true" size={22} />} error={error}>
      {!canTransfer && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{t('inventory.transferPermissionRequired')}</p>}
      {!transfer && canTransfer && (
        <>
          {products.length > 0 && warehouses.length > 0 && (
            <Card className="space-y-3 p-5">
              <h2 className="font-bold">{t('inventory.createTransfer')}</h2>
              <form className="space-y-3" onSubmit={(event) => void create(event)}>
                <label className="grid gap-1 text-sm font-semibold">{t('inventory.destinationWarehouse')}
                  <select className={fieldClass} onChange={(event) => setDestinationId(event.target.value)} required value={destinationId}>
                    <option value="">{t('inventory.chooseWarehouse')}</option>
                    {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                  </select>
                </label>
                {items.map((item, index) => (
                  <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]" key={index}>
                    <select className={fieldClass} onChange={(event) => {
                      const next = [...items]
                      next[index] = { ...item, productId: event.target.value }
                      setItems(next)
                    }} required value={item.productId}>
                      <option value="">{t('inventory.chooseProduct')}</option>
                      {products.filter((product) => product.id === item.productId || !items.some((other, otherIndex) => otherIndex !== index && other.productId === product.id)).map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
                    </select>
                    <input aria-label={t('inventory.quantity')} className={fieldClass} inputMode="decimal" min="0.000000001" onChange={(event) => {
                      const next = [...items]
                      next[index] = { ...item, quantity: event.target.value }
                      setItems(next)
                    }} required value={item.quantity} />
                    <Button disabled={items.length === 1} onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))} type="button" variant="secondary">{t('inventory.removeItem')}</Button>
                  </div>
                ))}
                <Button onClick={() => setItems([...items, { productId: '', quantity: '1' }])} type="button" variant="secondary">{t('inventory.addItem')}</Button>
                <textarea aria-label={t('inventory.transferNotes')} className={`${fieldClass} min-h-20 py-2`} maxLength={1000} onChange={(event) => setNotes(event.target.value)} value={notes} />
                <Button disabled={busy}>{t('inventory.submitTransfer')}</Button>
              </form>
            </Card>
          )}
          <ul className="grid gap-3">
            {transfers.map((item) => (
              <li key={item.id}><Link className="flex flex-wrap justify-between gap-2 rounded-xl border border-[var(--border)] bg-white p-4" to={`/inventory/transfers/${item.id}`}><span className="font-bold">{item.transferNumber}</span><span>{t(`inventory.transferStatus.${item.status}`, item.status)}</span></Link></li>
            ))}
          </ul>
        </>
      )}
      {transfer && (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-bold">{transfer.transferNumber}</h2><p className="text-sm text-[var(--muted)]">{t(`inventory.transferStatus.${transfer.status}`, transfer.status)}</p></div>
            <div className="flex flex-wrap gap-2">
              {transfer.status === 'draft' && <Button disabled={busy} onClick={() => {
                if (user) void perform((id) => services.inventory.submitTransfer(user.id, id))
              }}>{t('inventory.submitTransfer')}</Button>}
              {transfer.status === 'pending_approval' && <Button disabled={busy} onClick={() => {
                if (user) void perform((id) => services.inventory.approveTransfer(user.id, id))
              }}>{t('inventory.approveTransfer')}</Button>}
              {transfer.status === 'approved' && <Button disabled={busy} onClick={() => {
                if (user) void perform((id) => services.inventory.dispatchTransfer(user.id, id))
              }}>{t('inventory.dispatchTransfer')}</Button>}
              {transfer.status === 'in_transit' && <Button disabled={busy} onClick={() => {
                if (user) void perform((id) => services.inventory.receiveTransfer(user.id, id))
              }}>{t('inventory.receiveTransfer')}</Button>}
              {['draft', 'pending_approval', 'approved'].includes(transfer.status) && <Button disabled={busy} onClick={() => {
                if (user) void perform((id) => services.inventory.cancelTransfer(user.id, id))
              }} variant="secondary">{t('inventory.cancelTransfer')}</Button>}
            </div>
          </div>
          {transfer.items.map((item) => (
            <div className="flex flex-wrap justify-between gap-3 border-t border-[var(--border)] pt-3 text-sm" key={item.id}>
              <span>{products.find((product) => product.id === item.productId)?.name ?? item.productId}</span>
              <span>{item.quantity}</span>
              {item.receivedQuantity !== null && <span>{t('inventory.received')}: {item.receivedQuantity}</span>}
            </div>
          ))}
          <Link className="text-sm font-bold text-[var(--brand)]" to="/inventory/transfers">{t('inventory.backToTransfers')}</Link>
        </Card>
      )}
    </InventoryPage>
  )
}

function InventoryPage({
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
      <nav aria-label={t('inventory.navigation')} className="flex flex-wrap gap-2">
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/inventory">{t('inventory.title')}</Link>
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/warehouse-details">{t('inventory.warehouseDetails')}</Link>
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/inventory/counts">{t('inventory.stocktakingTitle')}</Link>
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/inventory/transfers">{t('inventory.transfersTitle')}</Link>
      </nav>
      {children}
    </main>
  )
}

function InventoryValue({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-[var(--muted)]">{label}</p><p className="font-bold">{value}</p></div>
}

function InventoryMetric({ label, value }: { label: string; value: string }) {
  return <Card className="p-4"><p className="text-xs font-semibold text-[var(--muted)]">{label}</p><p className="mt-2 text-xl font-black">{value}</p></Card>
}
