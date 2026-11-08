import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Barcode, Box, Plus, Search, Tag, Trash2 } from 'lucide-react'
import { useRetailApplicationServices } from '../../app/RetailApplicationServices'
import { useSessionStore } from '../auth/session-store'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { useConfirmDialog } from '../../shared/components/ConfirmDialog'
import { ToastError } from '../../shared/components/ToastError'
import type {
  CatalogBrand,
  CatalogCategory,
  CatalogProduct,
  MeasurementUnit,
} from './ProductCatalogService'

const inputClass = 'min-h-11 w-full rounded-xl border border-[var(--border)] bg-white px-3 text-[var(--ink)]'

export function ProductsScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { catalog } = useRetailApplicationServices()
  const user = useSessionStore((state) => state.user)
  const canCreate = Boolean(user?.permissions.includes('products.create'))
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [categories, setCategories] = useState<CatalogCategory[]>([])
  const [brands, setBrands] = useState<CatalogBrand[]>([])
  const [units, setUnits] = useState<MeasurementUnit[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [createFormOpen, setCreateFormOpen] = useState(false)

  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      if (!user) return
      try {
        let availableUnits = await catalog.listUnits(user.id)
        if (availableUnits.length === 0 && canCreate) {
          await catalog.initializeStandardUnits(user.id)
          availableUnits = await catalog.listUnits(user.id)
        }
        const [availableProducts, availableCategories, availableBrands] =
          await Promise.all([
            catalog.listProducts(user.id),
            catalog.listCategories(user.id),
            catalog.listBrands(user.id),
          ])
        if (!active) return
        setUnits(availableUnits)
        setProducts(availableProducts)
        setCategories(availableCategories)
        setBrands(availableBrands)
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : t('catalog.loadFailed'))
        }
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [canCreate, catalog, t, user])

  const visibleProducts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return products.filter((product) =>
      `${product.sku} ${product.name} ${product.barcodes.map((item) => item.barcode).join(' ')}`
        .toLocaleLowerCase()
        .includes(normalized),
    )
  }, [products, query])
  const activeCategories = categories.filter((item) => item.status === 'active')
  const activeBrands = brands.filter((item) => item.status === 'active')
  const activeUnits = units.filter((item) => item.status === 'active')

  return (
    <CatalogPage
      title={t('catalog.productsTitle')}
      description={t('catalog.productsDescription')}
      icon={<Box aria-hidden="true" size={22} />}
      error={error}
    >
      <label className="relative block">
        <Search aria-hidden="true" className="absolute start-3 top-3 text-[var(--muted)]" size={18} />
        <input
          aria-label={t('catalog.searchProducts')}
          className={`${inputClass} ps-10`}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('catalog.searchProducts')}
          value={query}
        />
      </label>
      {canCreate && activeUnits.length > 0 && user && (
        <>
          {!createFormOpen && (
            <Button className="w-full justify-center sm:w-auto" onClick={() => setCreateFormOpen(true)}>
              <Plus aria-hidden="true" size={18} />
              {t('catalog.openCreateProduct')}
            </Button>
          )}
          {createFormOpen && (
            <ProductEditor
              actorId={user.id}
              brands={activeBrands}
              categories={activeCategories}
              catalog={catalog}
              units={activeUnits}
              onCancel={() => setCreateFormOpen(false)}
              onSaved={(productId) => {
                void catalog.listProducts(user.id).then(setProducts).catch((loadError: unknown) => {
                  setError(loadError instanceof Error ? loadError.message : t('catalog.loadFailed'))
                })
                if (productId) navigate(`/products/${productId}`)
              }}
            />
          )}
        </>
      )}
      <div className="grid gap-3">
        {visibleProducts.length === 0 ? (
          <p className="rounded-xl bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
            {t('catalog.noProducts')}
          </p>
        ) : visibleProducts.map((product) => (
          <Link
            className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-white p-4 hover:border-[var(--brand)]"
            key={product.id}
            to={`/products/${product.id}`}
          >
            <div className="min-w-0">
              <p className="truncate font-bold text-[var(--ink)]">{product.name}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{product.sku}</p>
            </div>
            <span className="ms-auto text-sm text-[var(--muted)]">
              {t(`catalog.status.${product.status}`)}
            </span>
          </Link>
        ))}
      </div>
    </CatalogPage>
  )
}

export function ProductDetailsScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { productId } = useParams()
  const { catalog } = useRetailApplicationServices()
  const confirm = useConfirmDialog()
  const user = useSessionStore((state) => state.user)
  const [product, setProduct] = useState<CatalogProduct | null>(null)
  const [categories, setCategories] = useState<CatalogCategory[]>([])
  const [brands, setBrands] = useState<CatalogBrand[]>([])
  const [units, setUnits] = useState<MeasurementUnit[]>([])
  const [error, setError] = useState('')
  const canUpdate = Boolean(user?.permissions.includes('products.update'))
  const canDelete = Boolean(user?.permissions.includes('products.delete'))

  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      if (!user || !productId) return
      try {
        const [loadedProduct, availableCategories, availableBrands, availableUnits] =
          await Promise.all([
            catalog.getProduct(user.id, productId),
            catalog.listCategories(user.id),
            catalog.listBrands(user.id),
            catalog.listUnits(user.id),
          ])
        if (!active) return
        setProduct(loadedProduct)
        setCategories(availableCategories.filter((item) => item.status === 'active'))
        setBrands(availableBrands.filter((item) => item.status === 'active'))
        setUnits(availableUnits.filter((item) => item.status === 'active'))
        if (!loadedProduct) setError(t('catalog.productNotFound'))
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : t('catalog.loadFailed'))
        }
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [catalog, productId, t, user])

  const archive = async (): Promise<void> => {
    if (!user || !product || !canDelete) return
    if (!(await confirm({ message: t('catalog.confirmDeleteProduct'), destructive: true }))) return
    try {
      await catalog.archiveProduct(user.id, product.id)
      navigate('/products', { replace: true })
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : t('catalog.saveFailed'))
    }
  }

  const setStatus = async (status: 'active' | 'inactive'): Promise<void> => {
    if (!user || !product || !canUpdate) return
    try {
      await catalog.setProductStatus(user.id, product.id, status)
      setProduct({ ...product, status })
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : t('catalog.saveFailed'))
    }
  }

  return (
    <CatalogPage
      title={product?.name ?? t('catalog.productDetails')}
      description={product?.sku ?? t('catalog.productDetailsDescription')}
      icon={<Box aria-hidden="true" size={22} />}
      error={error}
    >
      <Link className="text-sm font-bold text-[var(--brand)]" to="/products">
        {t('catalog.backToProducts')}
      </Link>
      {product && user && units.length > 0 && (
        <>
          {canUpdate ? (
            <ProductEditor
              actorId={user.id}
              brands={brands}
              categories={categories}
              catalog={catalog}
              initial={product}
              units={units}
              onSaved={async () => {
                const updated = await catalog.getProduct(user.id, product.id)
                setProduct(updated)
              }}
            />
          ) : (
            <ProductSummary product={product} units={units} />
          )}
          <Card className="space-y-3 p-5">
            <h2 className="font-bold text-[var(--ink)]">{t('catalog.barcodes')}</h2>
            {product.barcodes.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t('catalog.noBarcodes')}</p>
            ) : product.barcodes.map((item) => (
              <div className="flex justify-between gap-3 text-sm" key={item.id}>
                <span className="font-mono">{item.barcode}</span>
                <span className="text-[var(--muted)]">
                  {units.find((unit) => unit.id === item.unitId)?.name ?? ''}
                </span>
              </div>
            ))}
          </Card>
          <div className="flex flex-wrap gap-2">
            {canUpdate && (
              <Button
                onClick={() => void setStatus(product.status === 'active' ? 'inactive' : 'active')}
                variant="secondary"
              >
                {product.status === 'active' ? t('catalog.deactivate') : t('catalog.activate')}
              </Button>
            )}
            {canDelete && (
              <Button className="text-red-700" onClick={() => void archive()} variant="secondary">
                <Trash2 aria-hidden="true" size={17} />
                {t('catalog.deleteProduct')}
              </Button>
            )}
          </div>
        </>
      )}
    </CatalogPage>
  )
}

export function CategoriesScreen() {
  const { t } = useTranslation()
  const { catalog } = useRetailApplicationServices()
  const confirm = useConfirmDialog()
  const user = useSessionStore((state) => state.user)
  const canCreate = Boolean(user?.permissions.includes('products.create'))
  const canUpdate = Boolean(user?.permissions.includes('products.update'))
  const [categories, setCategories] = useState<CatalogCategory[]>([])
  const [editing, setEditing] = useState<CatalogCategory | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    if (!user) return
    setCategories(await catalog.listCategories(user.id))
  }, [catalog, user])
  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('catalog.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user) return
    setError('')
    try {
      const input = { name, code, parentId: parentId || null }
      if (editing) await catalog.updateCategory(user.id, editing.id, input)
      else await catalog.createCategory(user.id, input)
      setEditing(null)
      setName('')
      setCode('')
      setParentId('')
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('catalog.saveFailed'))
    }
  }

  return (
    <CatalogPage
      title={t('catalog.categoriesTitle')}
      description={t('catalog.categoriesDescription')}
      icon={<Tag aria-hidden="true" size={22} />}
      error={error}
    >
      {(canCreate || editing) && (
        <form className="grid gap-3 rounded-2xl border border-[var(--border)] p-4 sm:grid-cols-2" onSubmit={(event) => void save(event)}>
          <input className={inputClass} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={t('catalog.name')} required value={name} />
          <input className={inputClass} maxLength={32} onChange={(event) => setCode(event.target.value)} placeholder={t('catalog.codeOptional')} value={code} />
          <select className={inputClass} onChange={(event) => setParentId(event.target.value)} value={parentId}>
            <option value="">{t('catalog.noParent')}</option>
            {categories.filter((item) => item.status === 'active' && item.id !== editing?.id).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button type="submit">{editing ? t('catalog.save') : t('catalog.addCategory')}</Button>
            {editing && <Button onClick={() => { setEditing(null); setName(''); setCode(''); setParentId('') }} variant="secondary">{t('catalog.cancel')}</Button>}
          </div>
        </form>
      )}
      <CatalogEntityList
        rows={categories}
        name={(item) => item.name}
        details={(item) => [item.code, item.parentId && categories.find((parent) => parent.id === item.parentId)?.name].filter(Boolean).join(' · ')}
        status={(item) => item.status}
        canUpdate={canUpdate}
        canArchive={canUpdate}
        onEdit={(item) => {
          setEditing(item)
          setName(item.name)
          setCode(item.code ?? '')
          setParentId(item.parentId ?? '')
        }}
        onArchive={async (item) => {
          if (!user || !(await confirm({ message: t('catalog.confirmArchiveCategory'), destructive: true }))) return
          try {
            await catalog.archiveCategory(user.id, item.id)
            await load()
          } catch (archiveError) {
            setError(archiveError instanceof Error ? archiveError.message : t('catalog.saveFailed'))
          }
        }}
      />
    </CatalogPage>
  )
}

export function BrandsScreen() {
  const { t } = useTranslation()
  const { catalog } = useRetailApplicationServices()
  const confirm = useConfirmDialog()
  const user = useSessionStore((state) => state.user)
  const canCreate = Boolean(user?.permissions.includes('products.create'))
  const canUpdate = Boolean(user?.permissions.includes('products.update'))
  const [brands, setBrands] = useState<CatalogBrand[]>([])
  const [editing, setEditing] = useState<CatalogBrand | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    if (!user) return
    setBrands(await catalog.listBrands(user.id))
  }, [catalog, user])
  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('catalog.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user) return
    setError('')
    try {
      if (editing) await catalog.updateBrand(user.id, editing.id, name)
      else await catalog.createBrand(user.id, { name })
      setEditing(null)
      setName('')
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('catalog.saveFailed'))
    }
  }

  return (
    <CatalogPage
      title={t('catalog.brandsTitle')}
      description={t('catalog.brandsDescription')}
      icon={<Tag aria-hidden="true" size={22} />}
      error={error}
    >
      {(canCreate || editing) && (
        <form className="flex flex-wrap gap-3" onSubmit={(event) => void save(event)}>
          <input className={`${inputClass} min-w-48 flex-1`} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={t('catalog.brandName')} required value={name} />
          <Button type="submit">{editing ? t('catalog.save') : t('catalog.addBrand')}</Button>
          {editing && <Button onClick={() => { setEditing(null); setName('') }} variant="secondary">{t('catalog.cancel')}</Button>}
        </form>
      )}
      <CatalogEntityList
        rows={brands}
        name={(item) => item.name}
        status={(item) => item.status}
        canUpdate={canUpdate}
        canArchive={canUpdate}
        onEdit={(item) => {
          setEditing(item)
          setName(item.name)
        }}
        onArchive={async (item) => {
          if (!user || !(await confirm({ message: t('catalog.confirmArchiveBrand'), destructive: true }))) return
          try {
            await catalog.archiveBrand(user.id, item.id)
            await load()
          } catch (archiveError) {
            setError(archiveError instanceof Error ? archiveError.message : t('catalog.saveFailed'))
          }
        }}
      />
    </CatalogPage>
  )
}

export function BarcodeManagementScreen() {
  const { t } = useTranslation()
  const { catalog } = useRetailApplicationServices()
  const confirm = useConfirmDialog()
  const user = useSessionStore((state) => state.user)
  const canUpdate = Boolean(user?.permissions.includes('products.update'))
  const canRemove = Boolean(user?.permissions.includes('products.update'))
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [units, setUnits] = useState<MeasurementUnit[]>([])
  const [productId, setProductId] = useState('')
  const [barcode, setBarcode] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    if (!user) return
    const [availableProducts, availableUnits] = await Promise.all([
      catalog.listProducts(user.id),
      catalog.listUnits(user.id),
    ])
    setProducts(availableProducts)
    setUnits(availableUnits)
  }, [catalog, user])
  useEffect(() => {
    let active = true
    void Promise.resolve().then(load).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('catalog.loadFailed'))
    })
    return () => { active = false }
  }, [load, t])

  const allBarcodes = products.flatMap((product) =>
    product.barcodes.map((item) => ({ ...item, product })),
  ).filter((item) =>
    `${item.barcode} ${item.product.sku} ${item.product.name}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  )

  const addBarcode = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!user || !canUpdate) return
    const product = products.find((item) => item.id === productId)
    if (!product) return
    setError('')
    try {
      await catalog.updateProduct(user.id, product.id, productInput(product, [
        ...product.barcodes.map((item) => ({ barcode: item.barcode, unitId: item.unitId })),
        { barcode, unitId: product.baseUnitId },
      ]))
      setBarcode('')
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('catalog.saveFailed'))
    }
  }

  return (
    <CatalogPage
      title={t('catalog.barcodesTitle')}
      description={t('catalog.barcodesDescription')}
      icon={<Barcode aria-hidden="true" size={22} />}
      error={error}
    >
      {canUpdate && products.some((item) => item.status !== 'archived') && (
        <form className="grid gap-3 sm:grid-cols-3" onSubmit={(event) => void addBarcode(event)}>
          <select className={inputClass} onChange={(event) => setProductId(event.target.value)} required value={productId}>
            <option value="">{t('catalog.chooseProduct')}</option>
            {products.filter((item) => item.status !== 'archived').map((item) => (
              <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>
            ))}
          </select>
          <input className={inputClass} maxLength={128} onChange={(event) => setBarcode(event.target.value)} placeholder={t('catalog.barcodeValue')} required value={barcode} />
          <Button type="submit"><Plus aria-hidden="true" size={18} />{t('catalog.addBarcode')}</Button>
        </form>
      )}
      <label className="relative block">
        <Search aria-hidden="true" className="absolute start-3 top-3 text-[var(--muted)]" size={18} />
        <input className={`${inputClass} ps-10`} onChange={(event) => setQuery(event.target.value)} placeholder={t('catalog.searchBarcodes')} value={query} />
      </label>
      <div className="grid gap-3">
        {allBarcodes.length === 0 ? (
          <p className="rounded-xl bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t('catalog.noBarcodes')}</p>
        ) : allBarcodes.map((item) => (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4" key={item.id}>
            <span className="font-mono font-bold">{item.barcode}</span>
            <span className="text-sm text-[var(--muted)]">{item.product.name} · {item.product.sku}</span>
            <span className="text-xs text-[var(--muted)]">{units.find((unit) => unit.id === item.unitId)?.name ?? ''}</span>
            {canRemove && (
              <Button
                onClick={() => {
                  if (!user) return
                  void confirm({ message: t('catalog.confirmRemoveBarcode'), destructive: true }).then((confirmed) => {
                    if (!confirmed) return
                    return catalog.updateProduct(
                    user.id,
                    item.product.id,
                    productInput(
                      item.product,
                      item.product.barcodes
                        .filter((barcodeItem) => barcodeItem.id !== item.id)
                        .map(({ barcode, unitId }) => ({ barcode, unitId })),
                    ),
                    ).then(load)
                  }).catch((removeError: unknown) => {
                    setError(removeError instanceof Error ? removeError.message : t('catalog.saveFailed'))
                  })
                }}
                variant="secondary"
              >
                {t('catalog.removeBarcode')}
              </Button>
            )}
          </Card>
        ))}
      </div>
    </CatalogPage>
  )
}

export function ProductEditor({
  actorId,
  catalog,
  categories,
  brands,
  units,
  initial,
  onSaved,
  onCancel,
}: {
  actorId: string
  catalog: ReturnType<typeof useRetailApplicationServices>['catalog']
  categories: CatalogCategory[]
  brands: CatalogBrand[]
  units: MeasurementUnit[]
  initial?: CatalogProduct
  onSaved: (productId: string) => void | Promise<void>
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const [sku, setSku] = useState(initial?.sku ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '')
  const [brandId, setBrandId] = useState(initial?.brandId ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [baseUnitId, setBaseUnitId] = useState(initial?.baseUnitId ?? units[0]?.id ?? '')
  const [purchasePrice, setPurchasePrice] = useState(initial?.purchasePrice ?? '0')
  const [sellingPrice, setSellingPrice] = useState(initial?.sellingPrice ?? '0')
  const [minimumStock, setMinimumStock] = useState(initial?.minimumStock ?? '0')
  const [barcode, setBarcode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editable = Boolean(initial)

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const input = {
      sku,
      name,
      categoryId: categoryId || null,
      brandId: brandId || null,
      description: description || null,
      baseUnitId,
      purchasePrice,
      sellingPrice,
      minimumStock,
      status: initial?.status === 'inactive' ? 'inactive' : 'active',
      barcodes: [
        ...(initial?.barcodes.map((item) => ({ barcode: item.barcode, unitId: item.unitId })) ?? []),
        ...(barcode.trim() ? [{ barcode: barcode.trim(), unitId: baseUnitId }] : []),
      ],
      attributes: initial?.attributes.map(({ name: attributeName, value }) => ({ name: attributeName, value })) ?? [],
      images: initial?.images.map(({ filePath, mimeType, sortOrder }) => ({
        filePath,
        mimeType,
        sortOrder,
      })) ?? [],
      conversions: initial?.conversions.map(({ unitId, factorToBase }) => ({ unitId, factorToBase })) ?? [],
    }
    try {
      const savedId = initial
        ? (await catalog.updateProduct(actorId, initial.id, input), initial.id)
        : await catalog.createProduct(actorId, input)
      setBarcode('')
      await onSaved(savedId)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('catalog.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-bold text-[var(--ink)]">
        {editable ? t('catalog.editProduct') : t('catalog.addProduct')}
      </h2>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void save(event)}>
        <input className={inputClass} maxLength={64} onChange={(event) => setSku(event.target.value)} placeholder={t('catalog.sku')} required value={sku} />
        <input className={inputClass} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={t('catalog.name')} required value={name} />
        <select className={inputClass} onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
          <option value="">{t('catalog.noCategory')}</option>
          {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select className={inputClass} onChange={(event) => setBrandId(event.target.value)} value={brandId}>
          <option value="">{t('catalog.noBrand')}</option>
          {brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select className={inputClass} onChange={(event) => setBaseUnitId(event.target.value)} required value={baseUnitId}>
          <option value="">{t('catalog.baseUnit')}</option>
          {units.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}
        </select>
        <input className={inputClass} inputMode="decimal" onChange={(event) => setPurchasePrice(event.target.value)} placeholder={t('catalog.purchasePrice')} required value={purchasePrice} />
        <input className={inputClass} inputMode="decimal" onChange={(event) => setSellingPrice(event.target.value)} placeholder={t('catalog.sellingPrice')} required value={sellingPrice} />
        <input className={inputClass} inputMode="decimal" onChange={(event) => setMinimumStock(event.target.value)} placeholder={t('catalog.minimumStock')} required value={minimumStock} />
        {!initial && (
          <input className={inputClass} maxLength={128} onChange={(event) => setBarcode(event.target.value)} placeholder={t('catalog.firstBarcodeOptional')} value={barcode} />
        )}
        <textarea className={`${inputClass} min-h-20 sm:col-span-2`} maxLength={4000} onChange={(event) => setDescription(event.target.value)} placeholder={t('catalog.descriptionOptional')} value={description} />
        {error && <><ToastError error={error} /><p className="text-sm text-red-700 sm:col-span-2" role="alert">{error}</p></>}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button disabled={busy || units.length === 0} type="submit">
            {busy ? t('catalog.saving') : editable ? t('catalog.saveProduct') : t('catalog.createProduct')}
          </Button>
          {!editable && onCancel && (
            <Button disabled={busy} onClick={onCancel} variant="secondary">
              {t('catalog.cancel')}
            </Button>
          )}
        </div>
      </form>
    </Card>
  )
}

function ProductSummary({
  product,
  units,
}: {
  product: CatalogProduct
  units: MeasurementUnit[]
}) {
  const { t } = useTranslation()
  return (
    <Card className="grid gap-3 p-5 sm:grid-cols-2">
      <SummaryValue label={t('catalog.sku')} value={product.sku} />
      <SummaryValue label={t('catalog.name')} value={product.name} />
      <SummaryValue label={t('catalog.baseUnit')} value={units.find((unit) => unit.id === product.baseUnitId)?.name ?? ''} />
      <SummaryValue label={t('catalog.purchasePrice')} value={product.purchasePrice} />
      <SummaryValue label={t('catalog.sellingPrice')} value={product.sellingPrice} />
      <SummaryValue label={t('catalog.minimumStock')} value={product.minimumStock} />
      <SummaryValue label={t('catalog.statusLabel')} value={t(`catalog.status.${product.status}`)} />
      <SummaryValue label={t('catalog.description')} value={product.description ?? ''} />
    </Card>
  )
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-sm font-bold text-[var(--ink)]">{value || '—'}</p>
    </div>
  )
}

function CatalogEntityList<T extends { id: string }>({
  rows,
  name,
  details,
  status,
  canUpdate,
  canArchive,
  onEdit,
  onArchive,
}: {
  rows: T[]
  name: (item: T) => string
  details?: (item: T) => string
  status: (item: T) => 'active' | 'archived'
  canUpdate: boolean
  canArchive: boolean
  onEdit: (item: T) => void
  onArchive: (item: T) => void | Promise<void>
}) {
  const { t } = useTranslation()
  if (rows.length === 0) {
    return <p className="rounded-xl bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t('catalog.noItems')}</p>
  }
  return (
    <ul className="grid gap-3">
      {rows.map((item) => (
        <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-white p-4" key={item.id}>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-[var(--ink)]">{name(item)}</p>
            {details && <p className="mt-1 text-sm text-[var(--muted)]">{details(item)}</p>}
          </div>
          <span className="text-xs text-[var(--muted)]">{t(`catalog.status.${status(item)}`)}</span>
          {status(item) === 'active' && canUpdate && (
            <Button onClick={() => onEdit(item)} variant="secondary">{t('catalog.edit')}</Button>
          )}
          {status(item) === 'active' && canArchive && (
            <Button onClick={() => void onArchive(item)} variant="secondary">{t('catalog.archive')}</Button>
          )}
        </li>
      ))}
    </ul>
  )
}

function CatalogPage({
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
      <nav aria-label={t('catalog.navigation')} className="flex gap-2 overflow-x-auto">
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/products">{t('catalog.productsTitle')}</Link>
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/categories">{t('catalog.categoriesTitle')}</Link>
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/brands">{t('catalog.brandsTitle')}</Link>
        <Link className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[var(--brand)]" to="/barcodes">{t('catalog.barcodesTitle')}</Link>
      </nav>
      {children}
    </main>
  )
}

function productInput(
  product: CatalogProduct,
  barcodes: Array<{ barcode: string; unitId: string | null }>,
) {
  return {
    sku: product.sku,
    name: product.name,
    categoryId: product.categoryId,
    brandId: product.brandId,
    description: product.description,
    baseUnitId: product.baseUnitId,
    purchasePrice: product.purchasePrice,
    sellingPrice: product.sellingPrice,
    minimumStock: product.minimumStock,
    status: product.status === 'inactive' ? 'inactive' as const : 'active' as const,
    barcodes,
    attributes: product.attributes.map(({ name, value }) => ({ name, value })),
    images: product.images.map(({ filePath, mimeType, sortOrder }) => ({
      filePath,
      mimeType,
      sortOrder,
    })),
    conversions: product.conversions.map(({ unitId, factorToBase }) => ({ unitId, factorToBase })),
  }
}
