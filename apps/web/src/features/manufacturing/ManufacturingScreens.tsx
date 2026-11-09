import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Factory, PackagePlus, ClipboardList, Plus } from 'lucide-react'
import { useRetailApplicationServices } from '../../app/RetailApplicationServices'
import { useSessionStore } from '../auth/session-store'
import { useWorkspaceStore } from '../../shared/state/workspace-store'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { ToastError } from '../../shared/components/ToastError'
import { translateMeasurementUnit } from '../../shared/i18n/measurementUnits'
import type { ManufacturingOrder } from './ManufacturingService'
import type { CatalogBrand, CatalogCategory, CatalogProduct, MeasurementUnit } from '../catalog/ProductCatalogService'
import { ProductEditor } from '../catalog/ProductCatalogScreens'

const fieldClass = 'min-h-11 w-full rounded-xl border border-[var(--border)] bg-white px-3 text-[var(--ink)]'

export function ManufacturingOrdersScreen() {
  const { t } = useTranslation()
  const services = useRetailApplicationServices()
  const { manufacturing, catalog } = services
  const user = useSessionStore((state) => state.user)
  const branchId = useWorkspaceStore((state) => state.branchId)
  const warehouseId = useWorkspaceStore((state) => state.warehouseId)
  const navigate = useNavigate()
  const [orders, setOrders] = useState<ManufacturingOrder[]>([])
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [categories, setCategories] = useState<CatalogCategory[]>([])
  const [brands, setBrands] = useState<CatalogBrand[]>([])
  const [units, setUnits] = useState<MeasurementUnit[]>([])
  const [activeTab, setActiveTab] = useState<'orders' | 'materials'>('orders')
  const [createOrderOpen, setCreateOrderOpen] = useState(false)
  const [createMaterialOpen, setCreateMaterialOpen] = useState(false)
  const [finishedProductId, setFinishedProductId] = useState('')
  const [materialLines, setMaterialLines] = useState([
    { productId: '', plannedQuantity: '' },
  ])
  const [plannedQuantity, setPlannedQuantity] = useState('')
  const [stages, setStages] = useState(t('manufacturing.defaultStages'))
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!user || !branchId || !warehouseId) return
    const [availableOrders, productsResult] = await Promise.all([
      manufacturing.listOrders(user.id, branchId, warehouseId),
      (async () => {
        let availableUnits = await catalog.listUnits(user.id)
        if (user.permissions.includes('products.create')) {
          await catalog.initializeStandardUnits(user.id)
          availableUnits = await catalog.listUnits(user.id)
        }
        const [availableProducts, availableCategories, availableBrands] = await Promise.all([
          catalog.listProducts(user.id, branchId, warehouseId),
          catalog.listCategories(user.id),
          catalog.listBrands(user.id),
        ])
        return { availableProducts, availableCategories, availableBrands, availableUnits }
      })(),
    ])
    setOrders(availableOrders)
    setProducts(productsResult.availableProducts.filter((product) => product.status === 'active'))
    setCategories(productsResult.availableCategories.filter((item) => item.status === 'active'))
    setBrands(productsResult.availableBrands.filter((item) => item.status === 'active'))
    setUnits(productsResult.availableUnits.filter((item) => item.status === 'active'))
  }, [branchId, catalog, manufacturing, user, warehouseId])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('manufacturing.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  const create = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (
      !user ||
      !warehouseId ||
      !finishedProductId ||
      materialLines.some((line) => !line.productId || !line.plannedQuantity)
    ) return
    setBusy(true)
    setError('')
    try {
      const materials = materialLines.map((line) => {
        const product = products.find((candidate) => candidate.id === line.productId)
        if (!product) throw new Error(t('manufacturing.chooseMaterial'))
        return {
          productId: product.id,
          unitId: product.baseUnitId,
          plannedQuantity: line.plannedQuantity,
        }
      })
      const id = await manufacturing.createOrder(user.id, {
        warehouseId,
        finishedProductId,
        plannedQuantity,
        materials,
        stages: stages.split(',').map((stage) => stage.trim()).filter(Boolean),
        notes: notes || null,
      })
      await load()
      navigate(`/manufacturing/${id}`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('manufacturing.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ManufacturingPage title={t('manufacturing.ordersTitle')} error={error}>
      <div aria-label={t('manufacturing.tabs')} className="flex flex-wrap gap-2" role="tablist">
        <button aria-selected={activeTab === 'orders'} className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold transition ${activeTab === 'orders' ? 'bg-[var(--brand)] text-white' : 'border border-[var(--border)] bg-white text-[var(--ink)]'}`} onClick={() => setActiveTab('orders')} role="tab" type="button">
          <ClipboardList aria-hidden="true" size={17} />{t('manufacturing.ordersTab')}
        </button>
        <button aria-selected={activeTab === 'materials'} className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold transition ${activeTab === 'materials' ? 'bg-[var(--brand)] text-white' : 'border border-[var(--border)] bg-white text-[var(--ink)]'}`} onClick={() => setActiveTab('materials')} role="tab" type="button">
          <PackagePlus aria-hidden="true" size={17} />{t('manufacturing.rawMaterialsTab')}
        </button>
      </div>
      {activeTab === 'orders' ? <>
      <section aria-label={t('manufacturing.productionSummary')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(['draft', 'planned', 'in_progress', 'completed'] as const).map((status) => (
          <Card className="flex items-center justify-between p-4" key={status}>
            <span className="text-sm font-semibold text-[var(--muted)]">{t(`manufacturing.status.${status}`)}</span>
            <span className="text-2xl font-black text-[var(--ink)]">
              {orders.filter((order) => order.status === status).length}
            </span>
          </Card>
        ))}
      </section>
      {user?.permissions.includes('manufacturing.manage') && !createOrderOpen && (
        <Button className="w-full justify-center sm:w-auto" onClick={() => {
          setStages(t('manufacturing.defaultStages'))
          setCreateOrderOpen(true)
        }}>
          <Plus aria-hidden="true" size={18} />{t('manufacturing.createOrder')}
        </Button>
      )}
      {user?.permissions.includes('manufacturing.manage') && createOrderOpen && (
        <Card className="space-y-5 border-[var(--brand-border)] p-5">
          <div>
            <h2 className="font-bold text-[var(--ink)]">{t('manufacturing.garmentOrder')}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{t('manufacturing.garmentOrderDescription')}</p>
          </div>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void create(event)}>
            <label className="grid gap-1 text-sm font-semibold">{t('manufacturing.finishedGarment')}
              <select className={fieldClass} onChange={(event) => setFinishedProductId(event.target.value)} required value={finishedProductId}>
                <option value="">{t('manufacturing.chooseProduct')}</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">{t('manufacturing.plannedGarments')}
              <input className={fieldClass} min="0.000000001" onChange={(event) => setPlannedQuantity(event.target.value)} required step="any" type="number" value={plannedQuantity} />
            </label>
            <section aria-label={t('manufacturing.materialRequirements')} className="space-y-3 sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold text-[var(--ink)]">{t('manufacturing.materialRequirements')}</h3>
                <Button
                  onClick={() => setMaterialLines([...materialLines, { productId: '', plannedQuantity: '' }])}
                  type="button"
                  variant="secondary"
                >
                  <Plus aria-hidden="true" size={17} />{t('manufacturing.addMaterialLine')}
                </Button>
              </div>
              {materialLines.map((line, index) => {
                const selectedProduct = products.find((product) => product.id === line.productId)
                return (
                  <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:grid-cols-[2fr_1fr_auto]" key={index}>
                    <label className="grid gap-1 text-sm font-semibold">
                      {t('manufacturing.materialNumber', { number: index + 1 })}
                      <select
                        className={fieldClass}
                        onChange={(event) => setMaterialLines(materialLines.map((item, lineIndex) =>
                          lineIndex === index ? { ...item, productId: event.target.value } : item,
                        ))}
                        required
                        value={line.productId}
                      >
                        <option value="">{t('manufacturing.chooseMaterial')}</option>
                        {products.filter((product) =>
                          product.id !== finishedProductId &&
                          !materialLines.some((other, otherIndex) =>
                            otherIndex !== index && other.productId === product.id,
                          ),
                        ).map((product) => (
                          <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm font-semibold">
                      {t('manufacturing.requiredMaterialQuantity')}
                      <input
                        className={fieldClass}
                        min="0.000000001"
                        onChange={(event) => setMaterialLines(materialLines.map((item, lineIndex) =>
                          lineIndex === index ? { ...item, plannedQuantity: event.target.value } : item,
                        ))}
                        required
                        step="any"
                        type="number"
                        value={line.plannedQuantity}
                      />
                      {selectedProduct && (
                        <span className="text-xs font-normal text-[var(--muted)]">
                          {translateMeasurementUnit(
                            units.find((unit) => unit.id === selectedProduct.baseUnitId)?.name ?? '',
                            t,
                          )}
                        </span>
                      )}
                    </label>
                    {materialLines.length > 1 && (
                      <Button
                        aria-label={t('manufacturing.removeMaterialLine')}
                        className="self-end"
                        onClick={() => setMaterialLines(materialLines.filter((_, lineIndex) => lineIndex !== index))}
                        type="button"
                        variant="secondary"
                      >
                        {t('manufacturing.removeMaterialLine')}
                      </Button>
                    )}
                  </div>
                )
              })}
            </section>
            <label className="grid gap-1 text-sm font-semibold sm:col-span-2">{t('manufacturing.garmentStages')}
              <textarea className={`${fieldClass} min-h-20 py-2`} onChange={(event) => setStages(event.target.value)} placeholder={t('manufacturing.stagesHint')} value={stages} />
              <span className="text-xs font-normal text-[var(--muted)]">{t('manufacturing.stagesHelp')}</span>
            </label>
            <label className="grid gap-1 text-sm font-semibold sm:col-span-2">{t('manufacturing.notes')}
              <textarea className={`${fieldClass} min-h-20 py-2`} maxLength={1000} onChange={(event) => setNotes(event.target.value)} value={notes} />
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button disabled={busy || products.length < 2} type="submit">{busy ? t('manufacturing.working') : t('manufacturing.createOrder')}</Button>
              <Button disabled={busy} onClick={() => setCreateOrderOpen(false)} variant="secondary">{t('manufacturing.cancel')}</Button>
            </div>
          </form>
        </Card>
      )}
      {orders.length === 0 ? <p className="rounded-xl bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t('manufacturing.noOrders')}</p> : orders.map((order) => (
        <Link key={order.id} to={`/manufacturing/${order.id}`}>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <span><span className="block font-bold">{order.orderNumber} · {order.finishedProductName}</span><span className="text-sm text-[var(--muted)]">{order.plannedQuantity} · {t(`manufacturing.status.${order.status}`, order.status)}</span></span>
            <span className="text-sm font-bold">{order.totalCost}</span>
          </Card>
        </Link>
      ))}
      </> : <>
        <Card className="space-y-3 p-5">
          <div>
            <h2 className="font-bold text-[var(--ink)]">{t('manufacturing.rawMaterialsTab')}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{t('manufacturing.rawMaterialsDescription')}</p>
          </div>
          {user?.permissions.includes('products.create') && units.length > 0 && !createMaterialOpen && (
            <Button className="w-full justify-center sm:w-auto" onClick={() => setCreateMaterialOpen(true)}>
              <PackagePlus aria-hidden="true" size={18} />{t('manufacturing.addRawMaterial')}
            </Button>
          )}
        </Card>
        {createMaterialOpen && user?.permissions.includes('products.create') && user.permissions.includes('products.read') && (
          <ProductEditor
            actorId={user.id}
            branchId={branchId ?? undefined}
            brands={brands}
            categories={categories}
            catalog={catalog}
            warehouseId={warehouseId ?? undefined}
            units={units}
            onInitialStock={user.permissions.includes('inventory.adjust') && warehouseId
              ? ({ productId, unitId, quantity, unitCost, reason }) =>
                  services.inventory.adjustStock(user.id, {
                    productId,
                    warehouseId,
                    unitId,
                    quantity,
                    unitCost,
                    direction: 'in',
                    reason,
                  })
              : undefined}
            onCancel={() => setCreateMaterialOpen(false)}
            onSaved={async () => {
              if (!branchId || !warehouseId) return
              const refreshed = await catalog.listProducts(user.id, branchId, warehouseId)
              setProducts(refreshed.filter((product) => product.status === 'active'))
              setCreateMaterialOpen(false)
            }}
          />
        )}
        {products.length === 0
          ? <p className="rounded-xl bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t('manufacturing.noRawMaterials')}</p>
          : products.map((product) => (
            <Link key={product.id} to={`/products/${product.id}`}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4 transition hover:border-[var(--brand-border)]">
                <span><span className="block font-bold">{product.name}</span><span className="text-sm text-[var(--muted)]">{product.sku}</span></span>
                <span className="text-sm text-[var(--muted)]">{product.purchasePrice} · {translateMeasurementUnit(units.find((unit) => unit.id === product.baseUnitId)?.name ?? '', t)}</span>
              </Card>
            </Link>
          ))}
      </>}
    </ManufacturingPage>
  )
}

export function ManufacturingDetailsScreen() {
  const { t } = useTranslation()
  const { manufacturing } = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const { orderId } = useParams()
  const [order, setOrder] = useState<ManufacturingOrder | null>(null)
  const [actualQuantity, setActualQuantity] = useState('')
  const [wasteQuantity, setWasteQuantity] = useState('')
  const [costType, setCostType] = useState('labor')
  const [costAmount, setCostAmount] = useState('')
  const [costDescription, setCostDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!user || !orderId) return
    setOrder(await manufacturing.getOrder(user.id, orderId))
  }, [manufacturing, orderId, user])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('manufacturing.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  const perform = async (action: (actorId: string, id: string) => Promise<void>): Promise<void> => {
    if (!user || !orderId) return
    setBusy(true)
    setError('')
    try {
      await action(user.id, orderId)
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('manufacturing.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  const addCost = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !orderId) return
    setBusy(true)
    setError('')
    try {
      await manufacturing.addProductionCost(user.id, orderId, { costType, amount: costAmount, description: costDescription })
      setCostAmount('')
      setCostDescription('')
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('manufacturing.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  const consume = async (): Promise<void> => {
    if (!user || !orderId || !order) return
    setBusy(true)
    setError('')
    try {
      await manufacturing.consumeMaterials(user.id, orderId, {
        materials: order.materials.map((material) => ({
          materialId: material.id,
          quantity: material.plannedQuantity,
        })),
      })
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('manufacturing.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  const complete = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !orderId) return
    setBusy(true)
    setError('')
    try {
      await manufacturing.completeOrder(user.id, orderId, { actualQuantity, wasteQuantity: wasteQuantity || '0' })
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('manufacturing.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ManufacturingPage title={order ? `${order.orderNumber} · ${order.finishedProductName}` : t('manufacturing.detailsTitle')} error={error}>
      {order && (
        <>
          <Card className="space-y-4 p-5">
            <p className="text-sm text-[var(--muted)]">{t(`manufacturing.status.${order.status}`, order.status)} · {t('manufacturing.plannedQuantity')}: {order.plannedQuantity}</p>
            {order.notes && <p>{order.notes}</p>}
            <div className="flex flex-wrap gap-2">
              {order.status === 'draft' && <Button disabled={busy} onClick={() => void perform((actorId, id) => manufacturing.planOrder(actorId, id))}>{t('manufacturing.plan')}</Button>}
              {order.status === 'planned' && <Button disabled={busy} onClick={() => void perform((actorId, id) => manufacturing.startOrder(actorId, id))}>{t('manufacturing.start')}</Button>}
              {order.status === 'in_progress' && order.materials.some((material) => material.consumedQuantity === null) && <Button disabled={busy} onClick={() => void consume()}>{t('manufacturing.consumeMaterials')}</Button>}
              {order.status === 'in_progress' && <form className="flex flex-wrap gap-2" onSubmit={(event) => void complete(event)}>
                <input aria-label={t('manufacturing.actualQuantity')} className={`${fieldClass} max-w-40`} min="0" onChange={(event) => setActualQuantity(event.target.value)} placeholder={t('manufacturing.actualQuantity')} required step="any" type="number" value={actualQuantity} />
                <input aria-label={t('manufacturing.wasteQuantity')} className={`${fieldClass} max-w-40`} min="0" onChange={(event) => setWasteQuantity(event.target.value)} placeholder={t('manufacturing.wasteQuantity')} step="any" type="number" value={wasteQuantity} />
                <Button disabled={busy}>{t('manufacturing.complete')}</Button>
              </form>}
              {order.status === 'completed' && order.output?.approvedAt === null && <Button disabled={busy} onClick={() => void perform((actorId, id) => manufacturing.approveFinishedGoods(actorId, id))}>{t('manufacturing.approveOutput')}</Button>}
            </div>
          </Card>
          <Card className="space-y-3 p-5">
            <h2 className="font-bold">{t('manufacturing.materials')}</h2>
            {order.materials.map((material) => <div className="flex justify-between gap-2 text-sm" key={material.id}><span>{material.productName} · {material.plannedQuantity} {translateMeasurementUnit(material.unitName, t)}</span><span>{material.consumedQuantity ?? t('manufacturing.notConsumed')}</span></div>)}
          </Card>
          {order.stages.length > 0 && <Card className="space-y-3 p-5">
            <h2 className="font-bold">{t('manufacturing.stages')}</h2>
            {order.stages.map((stage) => <div className="flex flex-wrap items-center justify-between gap-2" key={stage.id}>
              <span>{stage.sequence + 1}. {stage.name} · {t(`manufacturing.status.${stage.status}`, stage.status)}</span>
              {stage.status === 'pending' && <Button disabled={busy} onClick={() => {
                if (!user) return
                setBusy(true)
                void manufacturing.startStage(user.id, stage.id).then(load).catch((actionError: unknown) => setError(actionError instanceof Error ? actionError.message : t('manufacturing.actionFailed'))).finally(() => setBusy(false))
              }}>{t('manufacturing.startStage')}</Button>}
              {stage.status === 'in_progress' && <Button disabled={busy} onClick={() => {
                if (!user) return
                setBusy(true)
                void manufacturing.completeStage(user.id, stage.id).then(load).catch((actionError: unknown) => setError(actionError instanceof Error ? actionError.message : t('manufacturing.actionFailed'))).finally(() => setBusy(false))
              }}>{t('manufacturing.completeStage')}</Button>}
            </div>)}
          </Card>}
          {['planned', 'in_progress'].includes(order.status) && <Card className="space-y-3 p-5">
            <h2 className="font-bold">{t('manufacturing.addCost')}</h2>
            <form className="grid gap-3 sm:grid-cols-3" onSubmit={(event) => void addCost(event)}>
              <input aria-label={t('manufacturing.costType')} className={fieldClass} maxLength={40} onChange={(event) => setCostType(event.target.value)} required value={costType} />
              <input aria-label={t('manufacturing.amount')} className={fieldClass} min="0" onChange={(event) => setCostAmount(event.target.value)} required step="any" type="number" value={costAmount} />
              <input aria-label={t('manufacturing.costDescription')} className={fieldClass} maxLength={500} minLength={2} onChange={(event) => setCostDescription(event.target.value)} required value={costDescription} />
              <Button disabled={busy}>{t('manufacturing.saveCost')}</Button>
            </form>
          </Card>}
          <Card className="space-y-2 p-5">
            <h2 className="font-bold">{t('manufacturing.costs')}</h2>
            {order.costs.map((cost) => <div className="flex justify-between gap-2 text-sm" key={cost.id}><span>{cost.description}</span><span>{cost.amount}</span></div>)}
            <div className="border-t border-[var(--border)] pt-2 font-bold">{t('manufacturing.totalCost')}: {order.totalCost}</div>
          </Card>
          <Link className="text-sm font-semibold text-[var(--brand)]" to="/manufacturing">{t('manufacturing.backToOrders')}</Link>
        </>
      )}
    </ManufacturingPage>
  )
}

function ManufacturingPage({ title, error, children }: { title: string; error: string; children: React.ReactNode }) {
  const { t } = useTranslation()
  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-8">
    <header className="flex items-center gap-4">
      <span className="grid size-12 place-items-center rounded-2xl bg-[var(--brand-wash)] text-[var(--brand)]"><Factory aria-hidden="true" size={22} /></span>
      <div><h1 className="text-2xl font-black text-[var(--ink)]">{title}</h1><p className="text-sm text-[var(--muted)]">{t('manufacturing.description')}</p></div>
    </header>
    {error && <><ToastError error={error} /><p className="rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</p></>}
    {children}
  </main>
}
