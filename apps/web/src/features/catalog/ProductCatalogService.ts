import { z } from 'zod'
import { createUuid } from '../../infrastructure/database/uuid'
import type { SqlDatabase, SqlExecutor, SqlRow } from '../../infrastructure/database/types'
import { AccessControlService } from '../auth/AccessControlService'
import { AuthRepository } from '../auth/AuthRepository'
import { AuthorizationError } from '../auth/auth.errors'
import { CatalogError } from './catalog.errors'
import { ProductCatalogRepository } from './ProductCatalogRepository'

const nameSchema = z.string().trim().min(1).max(120)
const categoryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/)
const unitCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,15}$/)
const dimensionSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/)
const nonNegativeDecimalSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/)
const positiveDecimalSchema = z
  .string()
  .regex(/^(?=.*[1-9])(?:0|[1-9]\d*)(?:\.\d{1,9})?$/)
const categoryCodeValueSchema = z.union([
  categoryCodeSchema,
  z.literal('').transform(() => null),
  z.null(),
]).optional()

const categoryInputSchema = z.object({
  name: nameSchema,
  code: categoryCodeValueSchema,
  parentId: z.string().uuid().nullable().optional(),
})

const brandInputSchema = z.object({ name: nameSchema })

const unitInputSchema = z.object({
  code: unitCodeSchema,
  name: nameSchema,
  dimension: dimensionSchema,
  decimalPlaces: z.number().int().min(0).max(9),
})

const productDetailSchema = z.object({
  barcodes: z.array(
    z.object({
      barcode: z.string().trim().min(1).max(128).regex(/^\S+$/),
      unitId: z.string().uuid().nullable().optional(),
    }),
  ).max(100).default([]),
  attributes: z.array(
    z.object({
      name: z.string().trim().min(1).max(80),
      value: z.string().trim().max(500),
    }),
  ).max(100).default([]),
  images: z.array(
    z.object({
      filePath: z.string().trim().min(1).max(500).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
        .refine((path) =>
          path
            .split('/')
            .every((part) => part.length > 0 && part !== '.' && part !== '..'),
        ),
      mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
      sortOrder: z.number().int().min(0).max(10_000).optional(),
    }),
  ).max(20).default([]),
  conversions: z.array(
    z.object({
      unitId: z.string().uuid(),
      factorToBase: positiveDecimalSchema,
    }),
  ).max(100).default([]),
})

const productInputSchema = z.object({
  sku: z.string().trim().toUpperCase().min(1).max(64)
    .regex(/^[A-Z0-9][A-Z0-9._/-]*$/),
  name: nameSchema,
  categoryId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  baseUnitId: z.string().uuid(),
  purchasePrice: nonNegativeDecimalSchema,
  sellingPrice: nonNegativeDecimalSchema,
  minimumStock: nonNegativeDecimalSchema,
  status: z.enum(['active', 'inactive']).default('active'),
}).and(productDetailSchema)

const productStatusSchema = z.enum(['active', 'inactive'])

const catalogStatusSchema = z.enum(['active', 'archived'])

const categoryRowSchema = z.object({
  id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(),
  name: z.string(),
  code: z.string().nullable(),
  status: catalogStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
})

const brandRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: catalogStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
})

const unitRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  dimension: z.string(),
  decimal_places: z.number().int().min(0).max(9),
  status: catalogStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
})

const productRowSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  category_id: z.string().uuid().nullable(),
  brand_id: z.string().uuid().nullable(),
  description: z.string().nullable(),
  base_unit_id: z.string().uuid(),
  purchase_price: nonNegativeDecimalSchema,
  selling_price: nonNegativeDecimalSchema,
  minimum_stock: nonNegativeDecimalSchema,
  status: z.enum(['active', 'inactive', 'archived']),
  created_at: z.string(),
  updated_at: z.string(),
})

const barcodeRowSchema = z.object({
  id: z.string().uuid(),
  barcode: z.string().min(1).max(128),
  unit_id: z.string().uuid().nullable(),
})

const attributeRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  value: z.string().max(500),
})

const imageRowSchema = z.object({
  id: z.string().uuid(),
  file_path: z.string().min(1).max(500),
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  sort_order: z.number().int().min(0),
})

const conversionRowSchema = z.object({
  id: z.string().uuid(),
  unit_id: z.string().uuid(),
  factor_to_base: positiveDecimalSchema,
})

export type CatalogCategory = {
  id: string
  parentId: string | null
  name: string
  code: string | null
  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
}

export type CatalogBrand = {
  id: string
  name: string
  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
}

export type MeasurementUnit = {
  id: string
  code: string
  name: string
  dimension: string
  decimalPlaces: number
  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
}

export type CatalogProduct = {
  id: string
  sku: string
  name: string
  categoryId: string | null
  brandId: string | null
  description: string | null
  baseUnitId: string
  purchasePrice: string
  sellingPrice: string
  minimumStock: string
  status: 'active' | 'inactive' | 'archived'
  createdAt: string
  updatedAt: string
  barcodes: Array<{ id: string; barcode: string; unitId: string | null }>
  attributes: Array<{ id: string; name: string; value: string }>
  images: Array<{
    id: string
    filePath: string
    mimeType: string
    sortOrder: number
  }>
  conversions: Array<{
    id: string
    unitId: string
    factorToBase: string
  }>
}

const standardUnits = [
  { code: 'PC', name: 'Piece', dimension: 'count', decimalPlaces: 0 },
  { code: 'PK', name: 'Package', dimension: 'count', decimalPlaces: 0 },
  { code: 'CTN', name: 'Carton', dimension: 'count', decimalPlaces: 0 },
  { code: 'KG', name: 'Kilogram', dimension: 'mass', decimalPlaces: 3 },
  { code: 'TON', name: 'Ton', dimension: 'mass', decimalPlaces: 3 },
  { code: 'L', name: 'Liter', dimension: 'volume', decimalPlaces: 3 },
  { code: 'ML', name: 'Milliliter', dimension: 'volume', decimalPlaces: 0 },
  { code: 'M', name: 'Meter', dimension: 'length', decimalPlaces: 3 },
  { code: 'ROLL', name: 'Roll', dimension: 'count', decimalPlaces: 0 },
  { code: 'TOP', name: 'التوب', dimension: 'count', decimalPlaces: 0 },
  { code: 'BUNDLE', name: 'Bundle', dimension: 'count', decimalPlaces: 0 },
] as const

export class ProductCatalogService {
  private readonly database: SqlDatabase
  private readonly access: AccessControlService
  private readonly authRepository: AuthRepository
  private readonly repository: ProductCatalogRepository

  constructor(database: SqlDatabase) {
    this.database = database
    this.access = new AccessControlService(database)
    this.authRepository = new AuthRepository(database)
    this.repository = new ProductCatalogRepository(database)
  }

  async listCategories(actorId: string): Promise<CatalogCategory[]> {
    await this.access.assertPermission(actorId, 'products.read')
    return (await this.repository.listCategories()).map((row) =>
      this.parseCategory(row),
    )
  }

  async createCategory(actorId: string, input: unknown): Promise<string> {
    const parsed = categoryInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new CatalogError('The category details are invalid')
    }

    const id = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'products.create',
        transaction,
      )
      await this.assertActiveCategoryParent(
        parsed.data.parentId ?? null,
        null,
        transaction,
      )
      const inputCode =
        typeof parsed.data.code === 'string' ? parsed.data.code : null
      await this.repository.createCategory(
        {
          id,
          parentId: parsed.data.parentId ?? null,
          name: parsed.data.name,
          code: inputCode,
          createdAt: now,
        },
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'category.created',
        'category',
        id,
        null,
        { name: parsed.data.name, code: inputCode, parentId: parsed.data.parentId ?? null },
        now,
      )
    })
    return id
  }

  async updateCategory(
    actorId: string,
    categoryId: string,
    input: unknown,
  ): Promise<void> {
    const parsed = categoryInputSchema.safeParse(input)
    if (
      !parsed.success ||
      !z.string().uuid().safeParse(categoryId).success
    ) {
      throw new CatalogError('The category details are invalid')
    }

    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'products.update',
        transaction,
      )
      const before = await this.repository.getCategory(categoryId, transaction)
      if (!before || before.status !== 'active') {
        throw new CatalogError('The active category does not exist')
      }
      const parentId = parsed.data.parentId ?? null
      await this.assertActiveCategoryParent(parentId, categoryId, transaction)
      const code =
        typeof parsed.data.code === 'string' ? parsed.data.code : null
      await this.repository.updateCategory(
        categoryId,
        { parentId, name: parsed.data.name, code },
        now,
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'category.updated',
        'category',
        categoryId,
        this.auditRow(before),
        { name: parsed.data.name, code, parentId },
        now,
      )
    })
  }

  async archiveCategory(actorId: string, categoryId: string): Promise<void> {
    await this.archiveCatalogEntity(
      actorId,
      categoryId,
      'category',
      'category.archived',
    )
  }

  async listBrands(actorId: string): Promise<CatalogBrand[]> {
    await this.access.assertPermission(actorId, 'products.read')
    return (await this.repository.listBrands()).map((row) =>
      this.parseBrand(row),
    )
  }

  async createBrand(actorId: string, input: unknown): Promise<string> {
    const parsed = brandInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new CatalogError('The brand details are invalid')
    }
    const id = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'products.create',
        transaction,
      )
      await this.repository.createBrand(
        { id, name: parsed.data.name, createdAt: now },
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'brand.created',
        'brand',
        id,
        null,
        { name: parsed.data.name },
        now,
      )
    })
    return id
  }

  async updateBrand(
    actorId: string,
    brandId: string,
    name: string,
  ): Promise<void> {
    const parsed = nameSchema.safeParse(name)
    if (!parsed.success || !z.string().uuid().safeParse(brandId).success) {
      throw new CatalogError('The brand details are invalid')
    }
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'products.update',
        transaction,
      )
      const before = await this.repository.getBrand(brandId, transaction)
      if (!before || before.status !== 'active') {
        throw new CatalogError('The active brand does not exist')
      }
      await this.repository.updateBrand(
        brandId,
        parsed.data,
        now,
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'brand.updated',
        'brand',
        brandId,
        this.auditRow(before),
        { name: parsed.data },
        now,
      )
    })
  }

  async archiveBrand(actorId: string, brandId: string): Promise<void> {
    await this.archiveCatalogEntity(actorId, brandId, 'brand', 'brand.archived')
  }

  async listUnits(actorId: string): Promise<MeasurementUnit[]> {
    await this.access.assertPermission(actorId, 'products.read')
    return (await this.repository.listUnits()).map((row) =>
      this.parseUnit(row),
    )
  }

  async initializeStandardUnits(actorId: string): Promise<void> {
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const principal = await this.authRepository.getPrincipal(actorId, transaction)
      if (
        !principal ||
        (!principal.permissions.includes('products.create') &&
          !principal.permissions.includes('products.update'))
      ) {
        throw new AuthorizationError(
          'Permission required: products.create or products.update',
        )
      }
      const existing = await this.repository.listUnits(transaction)
      const codes = new Set(
        existing.map((row) => String(row.code).toUpperCase()),
      )
      for (const unit of standardUnits) {
        if (!codes.has(unit.code)) {
          await this.repository.createUnit(
            { id: createUuid(), ...unit, createdAt: now },
            transaction,
          )
        }
      }
    })
  }

  async createUnit(actorId: string, input: unknown): Promise<string> {
    const parsed = unitInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new CatalogError('The measurement unit details are invalid')
    }
    const id = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'products.create',
        transaction,
      )
      await this.repository.createUnit(
        {
          id,
          code: parsed.data.code,
          name: parsed.data.name,
          dimension: parsed.data.dimension,
          decimalPlaces: parsed.data.decimalPlaces,
          createdAt: now,
        },
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'measurement_unit.created',
        'measurement_unit',
        id,
        null,
        parsed.data,
        now,
      )
    })
    return id
  }

  async updateUnit(
    actorId: string,
    unitId: string,
    input: unknown,
  ): Promise<void> {
    const parsed = unitInputSchema.safeParse(input)
    if (!parsed.success || !z.string().uuid().safeParse(unitId).success) {
      throw new CatalogError('The measurement unit details are invalid')
    }
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'products.update',
        transaction,
      )
      const before = await this.repository.getUnit(unitId, transaction)
      if (!before || before.status !== 'active') {
        throw new CatalogError('The active measurement unit does not exist')
      }
      if (await this.repository.unitIsReferenced(unitId, transaction)) {
        throw new CatalogError(
          'A measurement unit cannot be changed after it is used by a product or transaction',
        )
      }
      await this.repository.updateUnit(
        unitId,
        {
          code: parsed.data.code,
          name: parsed.data.name,
          dimension: parsed.data.dimension,
          decimalPlaces: parsed.data.decimalPlaces,
        },
        now,
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'measurement_unit.updated',
        'measurement_unit',
        unitId,
        this.auditRow(before),
        parsed.data,
        now,
      )
    })
  }

  async archiveUnit(actorId: string, unitId: string): Promise<void> {
    if (!z.string().uuid().safeParse(unitId).success) {
      throw new CatalogError('The measurement unit identifier is invalid')
    }
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'products.update',
        transaction,
      )
      const unit = await this.repository.getUnit(unitId, transaction)
      if (!unit || unit.status !== 'active') {
        throw new CatalogError('The active measurement unit does not exist')
      }
      if (await this.repository.unitIsReferenced(unitId, transaction)) {
        throw new CatalogError(
          'A measurement unit cannot be archived while products or transactions reference it',
        )
      }
      await this.repository.archiveUnit(unitId, now, transaction)
      await this.writeAudit(
        transaction,
        actorId,
        'measurement_unit.archived',
        'measurement_unit',
        unitId,
        this.auditRow(unit),
        { status: 'archived' },
        now,
      )
    })
  }

  async listProducts(
    actorId: string,
    branchId?: string,
    warehouseId?: string,
  ): Promise<CatalogProduct[]> {
    await this.access.assertPermission(actorId, 'products.read')
    if (warehouseId && !branchId) {
      throw new CatalogError('A branch is required when selecting a warehouse')
    }
    if (branchId) {
      if (warehouseId) {
        await this.assertProductWarehouseAccess(actorId, branchId, warehouseId)
      } else {
        await this.assertProductBranchAccess(actorId, branchId)
      }
    }
    const rows = warehouseId && branchId
      ? await this.repository.listProductsForWarehouse(branchId, warehouseId)
      : branchId
        ? await this.repository.listProductsForBranch(branchId)
        : await this.repository.listProducts()
    return Promise.all(
      rows.map(async (row) =>
        this.loadProduct(row, this.database),
      ),
    )
  }

  async getProduct(
    actorId: string,
    productId: string,
    branchId?: string,
    warehouseId?: string,
  ): Promise<CatalogProduct | null> {
    await this.access.assertPermission(actorId, 'products.read')
    if (!z.string().uuid().safeParse(productId).success) {
      throw new CatalogError('The product identifier is invalid')
    }
    if (warehouseId && !branchId) {
      throw new CatalogError('A branch is required when selecting a warehouse')
    }
    if (branchId) {
      if (warehouseId) {
        await this.assertProductWarehouseAccess(actorId, branchId, warehouseId)
      } else {
        await this.assertProductBranchAccess(actorId, branchId)
      }
    }
    const row = warehouseId && branchId
      ? await this.repository.getProductForWarehouse(productId, branchId, warehouseId)
      : branchId
        ? await this.repository.getProductForBranch(productId, branchId)
        : await this.repository.getProduct(productId)
    return row ? this.loadProduct(row, this.database) : null
  }

  async getProductByBarcode(
    actorId: string,
    barcode: string,
    branchId?: string,
    warehouseId?: string,
  ): Promise<CatalogProduct | null> {
    await this.access.assertPermission(actorId, 'products.read')
    const parsedBarcode = z.string().trim().min(1).max(128).safeParse(barcode)
    if (!parsedBarcode.success) {
      throw new CatalogError('The barcode is invalid')
    }
    if (warehouseId && !branchId) {
      throw new CatalogError('A branch is required when selecting a warehouse')
    }
    if (branchId) {
      if (warehouseId) {
        await this.assertProductWarehouseAccess(actorId, branchId, warehouseId)
      } else {
        await this.assertProductBranchAccess(actorId, branchId)
      }
    }
    const row = warehouseId && branchId
      ? await this.repository.getProductByBarcodeForWarehouse(
          parsedBarcode.data,
          branchId,
          warehouseId,
        )
      : branchId
        ? await this.repository.getProductByBarcodeForBranch(
            parsedBarcode.data,
            branchId,
          )
        : await this.repository.getProductByBarcode(parsedBarcode.data)
    return row ? this.loadProduct(row, this.database) : null
  }

  async listProductsNotInWarehouse(
    actorId: string,
    branchId?: string,
    warehouseId?: string,
  ): Promise<CatalogProduct[]> {
    await this.access.assertPermission(actorId, 'products.read')
    if (!branchId || !warehouseId) {
      throw new CatalogError('Select a branch and warehouse first')
    }
    await this.assertProductWarehouseAccess(actorId, branchId, warehouseId)
    const rows = await this.repository.listProductsNotInWarehouse(branchId, warehouseId)
    return Promise.all(rows.map((row) => this.loadProduct(row, this.database)))
  }

  async assignProductToWarehouse(
    actorId: string,
    productId: string,
    branchId?: string,
    warehouseId?: string,
  ): Promise<void> {
    if (!z.string().uuid().safeParse(productId).success || !branchId || !warehouseId) {
      throw new CatalogError('The product and warehouse selection is invalid')
    }
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'products.create', transaction)
      await this.assertProductWarehouseAccess(actorId, branchId, warehouseId, transaction)
      if (!(await this.repository.hasProductBranchAvailability(
        productId,
        branchId,
        transaction,
      ))) {
        throw new CatalogError('The product is not available in this branch')
      }
      await this.repository.assignProductToWarehouse(
        productId,
        branchId,
        warehouseId,
        now,
        transaction,
      )
    })
  }

  async createProduct(
    actorId: string,
    input: unknown,
    branchId?: string,
    warehouseId?: string,
  ): Promise<string> {
    const parsed = productInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new CatalogError('The product details are invalid')
    }
    this.assertUniqueDetails(parsed.data)
    const id = createUuid()
    const now = new Date().toISOString()

    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'products.create',
        transaction,
      )
      if (branchId) {
        if (warehouseId) {
          await this.assertProductWarehouseAccess(actorId, branchId, warehouseId, transaction)
        } else {
          await this.assertProductBranchAccess(actorId, branchId, transaction)
        }
      } else if (warehouseId) {
        throw new CatalogError('A branch is required when selecting a warehouse')
      }
      await this.assertActiveReferences(
        parsed.data,
        transaction,
      )
      await this.assertUnitPrecision(
        parsed.data.minimumStock,
        parsed.data.baseUnitId,
        transaction,
      )
      await this.repository.createProduct(
        this.productFields(id, parsed.data, now),
        transaction,
      )
      if (branchId) {
        await this.repository.createProductBranchAvailability(
          {
            productId: id,
            branchId,
            purchasePrice: parsed.data.purchasePrice,
            sellingPrice: parsed.data.sellingPrice,
            minimumStock: parsed.data.minimumStock,
            status: 'active',
            createdAt: now,
          },
          transaction,
        )
      }
      if (branchId && warehouseId) {
        await this.repository.createProductWarehouseAvailability(
          {
            productId: id,
            branchId,
            warehouseId,
            purchasePrice: parsed.data.purchasePrice,
            sellingPrice: parsed.data.sellingPrice,
            minimumStock: parsed.data.minimumStock,
            status: 'active',
            createdAt: now,
          },
          transaction,
        )
      }
      await this.replaceProductDetails(
        id,
        parsed.data,
        now,
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'product.created',
        'product',
        id,
        null,
        this.productAuditData(parsed.data),
        now,
      )
    })
    return id
  }

  async updateProduct(
    actorId: string,
    productId: string,
    input: unknown,
    branchId?: string,
    warehouseId?: string,
  ): Promise<void> {
    const parsed = productInputSchema.safeParse(input)
    if (
      !parsed.success ||
      !z.string().uuid().safeParse(productId).success
    ) {
      throw new CatalogError('The product details are invalid')
    }
    this.assertUniqueDetails(parsed.data)
    if (warehouseId && !branchId) {
      throw new CatalogError('A branch is required when selecting a warehouse')
    }
    const now = new Date().toISOString()

    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'products.update',
        transaction,
      )
      if (branchId) {
        if (warehouseId) {
          await this.assertProductWarehouseAccess(actorId, branchId, warehouseId, transaction)
          if (!(await this.repository.hasProductWarehouseAvailability(
            productId,
            warehouseId,
            transaction,
          ))) {
            throw new CatalogError('The product is not available in this warehouse')
          }
        } else {
          await this.assertProductBranchAccess(actorId, branchId, transaction)
          if (!(await this.repository.hasProductBranchAvailability(
            productId,
            branchId,
            transaction,
          ))) {
            throw new CatalogError('The product is not available in this branch')
          }
        }
      }
      const beforeRow = warehouseId && branchId
        ? await this.repository.getProductForWarehouse(productId, branchId, warehouseId, transaction)
        : branchId
          ? await this.repository.getProductForBranch(productId, branchId, transaction)
          : await this.repository.getProduct(productId, transaction)
      if (!beforeRow || beforeRow.status === 'archived') {
        throw new CatalogError('The product does not exist or is archived')
      }
      const before = await this.loadProduct(beforeRow, transaction)
      const principal = branchId
        ? await this.authRepository.getPrincipal(actorId, transaction)
        : null
      const canEditSharedCatalog = !branchId || Boolean(
        principal?.roleCodes.some((role) =>
          ['system_owner', 'general_manager', 'admin'].includes(role),
        ),
      )
      if (
        branchId &&
        !canEditSharedCatalog &&
        this.hasSharedProductChanges(before, parsed.data)
      ) {
        throw new CatalogError(
          'Branch users may only change product pricing and availability',
        )
      }
      await this.assertActiveReferences(
        parsed.data,
        transaction,
      )
      await this.assertUnitPrecision(
        parsed.data.minimumStock,
        parsed.data.baseUnitId,
        transaction,
      )
      if (canEditSharedCatalog) {
        await this.repository.updateProduct(
          productId,
          this.productUpdateFields(parsed.data),
          now,
          transaction,
        )
      }
      if (warehouseId) {
        await this.repository.updateProductWarehouseAvailability(
          productId,
          warehouseId,
          {
            purchasePrice: parsed.data.purchasePrice,
            sellingPrice: parsed.data.sellingPrice,
            minimumStock: parsed.data.minimumStock,
          },
          now,
          transaction,
        )
      } else if (branchId) {
        await this.repository.updateProductBranchAvailability(
          productId,
          branchId,
          {
            purchasePrice: parsed.data.purchasePrice,
            sellingPrice: parsed.data.sellingPrice,
            minimumStock: parsed.data.minimumStock,
          },
          now,
          transaction,
        )
      }
      if (canEditSharedCatalog) {
        await this.repository.deleteProductDetails(productId, transaction)
        await this.replaceProductDetails(
          productId,
          parsed.data,
          now,
          transaction,
        )
      }
      await this.writeAudit(
        transaction,
        actorId,
        'product.updated',
        'product',
        productId,
        before,
        this.productAuditData(parsed.data),
        now,
      )
    })
  }

  async setProductStatus(
    actorId: string,
    productId: string,
    status: string,
    branchId?: string,
    warehouseId?: string,
  ): Promise<void> {
    const parsedStatus = productStatusSchema.safeParse(status)
    if (
      !parsedStatus.success ||
      !z.string().uuid().safeParse(productId).success
    ) {
      throw new CatalogError('The product status is invalid')
    }
    if (warehouseId && !branchId) {
      throw new CatalogError('A branch is required when selecting a warehouse')
    }
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'products.update',
        transaction,
      )
      if (branchId) {
        if (warehouseId) {
          await this.assertProductWarehouseAccess(actorId, branchId, warehouseId, transaction)
        } else {
          await this.assertProductBranchAccess(actorId, branchId, transaction)
        }
      }
      const before = warehouseId && branchId
        ? await this.repository.getProductForWarehouse(productId, branchId, warehouseId, transaction)
        : branchId
          ? await this.repository.getProductForBranch(productId, branchId, transaction)
          : await this.repository.getProduct(productId, transaction)
      if (!before || before.status === 'archived') {
        throw new CatalogError('The product does not exist or is archived')
      }
      if (warehouseId) {
        await this.repository.setProductWarehouseAvailabilityStatus(
          productId,
          warehouseId,
          parsedStatus.data,
          now,
          transaction,
        )
      } else if (branchId) {
        await this.repository.setProductBranchAvailabilityStatus(
          productId,
          branchId,
          parsedStatus.data,
          now,
          transaction,
        )
      } else {
        await this.repository.setProductStatus(
          productId,
          parsedStatus.data,
          now,
          transaction,
        )
      }
      await this.writeAudit(
        transaction,
        actorId,
        'product.status_updated',
        'product',
        productId,
        { status: before.status },
        { status: parsedStatus.data },
        now,
      )
    })
  }

  async archiveProduct(
    actorId: string,
    productId: string,
    branchId?: string,
    warehouseId?: string,
  ): Promise<void> {
    if (!z.string().uuid().safeParse(productId).success) {
      throw new CatalogError('The product identifier is invalid')
    }
    if (warehouseId && !branchId) {
      throw new CatalogError('A branch is required when selecting a warehouse')
    }
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'products.delete',
        transaction,
      )
      if (branchId) {
        if (warehouseId) {
          await this.assertProductWarehouseAccess(actorId, branchId, warehouseId, transaction)
        } else {
          await this.assertProductBranchAccess(actorId, branchId, transaction)
        }
      }
      const product = warehouseId && branchId
        ? await this.repository.getProductForWarehouse(productId, branchId, warehouseId, transaction)
        : branchId
          ? await this.repository.getProductForBranch(productId, branchId, transaction)
          : await this.repository.getProduct(productId, transaction)
      if (!product || product.status === 'archived') {
        throw new CatalogError('The active product does not exist')
      }
      if (warehouseId) {
        await this.repository.setProductWarehouseAvailabilityStatus(
          productId,
          warehouseId,
          'inactive',
          now,
          transaction,
        )
      } else if (branchId) {
        await this.repository.setProductBranchAvailabilityStatus(
          productId,
          branchId,
          'inactive',
          now,
          transaction,
        )
      } else {
        await this.repository.setProductStatus(
          productId,
          'archived',
          now,
          transaction,
        )
      }
      await this.writeAudit(
        transaction,
        actorId,
        'product.archived',
        'product',
        productId,
        { status: product.status },
        { status: 'archived' },
        now,
      )
    })
  }

  private async archiveCatalogEntity(
    actorId: string,
    entityId: string,
    entity: 'category' | 'brand',
    action: string,
  ): Promise<void> {
    if (!z.string().uuid().safeParse(entityId).success) {
      throw new CatalogError(`The ${entity} identifier is invalid`)
    }
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(
        actorId,
        'products.update',
        transaction,
      )
      const record =
        entity === 'category'
          ? await this.repository.getCategory(entityId, transaction)
          : await this.repository.getBrand(entityId, transaction)
      if (!record || record.status !== 'active') {
        throw new CatalogError(`The active ${entity} does not exist`)
      }

      const usageQuery =
        entity === 'category'
          ? `SELECT
               EXISTS (SELECT 1 FROM products WHERE category_id = ? AND status <> 'archived') AS has_products,
               EXISTS (SELECT 1 FROM categories WHERE parent_id = ? AND status = 'active') AS has_children`
          : `SELECT
               EXISTS (SELECT 1 FROM products WHERE brand_id = ? AND status <> 'archived') AS has_products,
               0 AS has_children`
      const [usage] = await transaction.query<{
        has_products: number
        has_children: number
      }>(usageQuery, entity === 'category' ? [entityId, entityId] : [entityId])
      if (!usage || usage.has_products !== 0 || usage.has_children !== 0) {
        throw new CatalogError(
          `The ${entity} is still assigned to products or active child categories`,
        )
      }

      if (entity === 'category') {
        await this.repository.archiveCategory(entityId, now, transaction)
      } else {
        await this.repository.archiveBrand(entityId, now, transaction)
      }
      await this.writeAudit(
        transaction,
        actorId,
        action,
        entity,
        entityId,
        this.auditRow(record),
        { status: 'archived' },
        now,
      )
    })
  }

  private async assertActiveCategoryParent(
    parentId: string | null,
    categoryId: string | null,
    executor: SqlExecutor,
  ): Promise<void> {
    let currentId = parentId
    const visited = new Set<string>()
    while (currentId) {
      if (currentId === categoryId || visited.has(currentId)) {
        throw new CatalogError('Category hierarchy cannot contain a cycle')
      }
      visited.add(currentId)
      const parent = await this.repository.getCategory(currentId, executor)
      if (!parent || parent.status !== 'active') {
        throw new CatalogError('A category parent must be active')
      }
      currentId =
        typeof parent.parent_id === 'string' ? parent.parent_id : null
    }
  }

  private async assertActiveReferences(
    input: z.infer<typeof productInputSchema>,
    executor: SqlExecutor,
  ): Promise<void> {
    const baseUnit = await this.repository.getUnit(input.baseUnitId, executor)
    if (!baseUnit || baseUnit.status !== 'active') {
      throw new CatalogError('The base measurement unit must be active')
    }

    if (input.categoryId) {
      const category = await this.repository.getCategory(
        input.categoryId,
        executor,
      )
      if (!category || category.status !== 'active') {
        throw new CatalogError('The selected category must be active')
      }
    }
    if (input.brandId) {
      const brand = await this.repository.getBrand(input.brandId, executor)
      if (!brand || brand.status !== 'active') {
        throw new CatalogError('The selected brand must be active')
      }
    }

    const permittedUnitIds = new Set([
      input.baseUnitId,
      ...input.conversions.map((conversion) => conversion.unitId),
    ])
    for (const conversion of input.conversions) {
      if (conversion.unitId === input.baseUnitId) {
        throw new CatalogError(
          'The base unit must not also be configured as a conversion',
        )
      }
      const unit = await this.repository.getUnit(
        conversion.unitId,
        executor,
      )
      if (!unit || unit.status !== 'active') {
        throw new CatalogError('Every conversion unit must be active')
      }
    }
    for (const barcode of input.barcodes) {
      const unitId = barcode.unitId ?? input.baseUnitId
      if (!permittedUnitIds.has(unitId)) {
        throw new CatalogError(
          'A barcode unit must be the base unit or a configured product unit',
        )
      }
      const unit = await this.repository.getUnit(unitId, executor)
      if (!unit || unit.status !== 'active') {
        throw new CatalogError('Every barcode unit must be active')
      }
    }
  }

  private async assertProductBranchAccess(
    actorId: string,
    branchId: string,
    executor?: SqlExecutor,
  ): Promise<void> {
    if (!z.string().uuid().safeParse(branchId).success) {
      throw new CatalogError('The selected branch identifier is invalid')
    }
    await this.access.assertBranchAccess(actorId, branchId, executor)
  }

  private async assertProductWarehouseAccess(
    actorId: string,
    branchId: string,
    warehouseId: string,
    executor?: SqlExecutor,
  ): Promise<void> {
    if (
      !z.string().uuid().safeParse(branchId).success ||
      !z.string().uuid().safeParse(warehouseId).success
    ) {
      throw new CatalogError('The selected branch or warehouse identifier is invalid')
    }
    await this.access.assertBranchAccess(actorId, branchId, executor)
    await this.access.assertWarehouseAccess(actorId, warehouseId, branchId, executor)
  }

  private hasSharedProductChanges(
    product: CatalogProduct,
    input: z.infer<typeof productInputSchema>,
  ): boolean {
    return product.sku !== input.sku ||
      product.name !== input.name ||
      product.categoryId !== (input.categoryId ?? null) ||
      product.brandId !== (input.brandId ?? null) ||
      product.description !== (input.description ?? null) ||
      product.baseUnitId !== input.baseUnitId ||
      JSON.stringify(product.barcodes.map(({ barcode, unitId }) => ({ barcode, unitId }))) !==
        JSON.stringify(input.barcodes.map(({ barcode, unitId }) => ({ barcode, unitId }))) ||
      JSON.stringify(product.attributes.map(({ name, value }) => ({ name, value }))) !==
        JSON.stringify(input.attributes.map(({ name, value }) => ({ name, value }))) ||
      JSON.stringify(product.images.map(({ filePath, mimeType, sortOrder }) => ({
        filePath,
        mimeType,
        sortOrder,
      }))) !==
        JSON.stringify(input.images.map(({ filePath, mimeType, sortOrder }) => ({
          filePath,
          mimeType,
          sortOrder: sortOrder ?? 0,
        }))) ||
      JSON.stringify(product.conversions.map(({ unitId, factorToBase }) => ({
        unitId,
        factorToBase,
      }))) !==
        JSON.stringify(input.conversions.map(({ unitId, factorToBase }) => ({
          unitId,
          factorToBase,
        })))
  }

  private async assertUnitPrecision(
    quantity: string,
    unitId: string,
    executor: SqlExecutor,
  ): Promise<void> {
    const unit = await this.repository.getUnit(unitId, executor)
    if (!unit) {
      throw new CatalogError('The base measurement unit does not exist')
    }
    const fractionLength = quantity.split('.')[1]?.length ?? 0
    if (fractionLength > Number(unit.decimal_places)) {
      throw new CatalogError(
        'The minimum stock quantity exceeds the base unit precision',
      )
    }
  }

  private assertUniqueDetails(
    input: z.infer<typeof productInputSchema>,
  ): void {
    const barcodeValues = input.barcodes.map((item) => item.barcode)
    if (new Set(barcodeValues).size !== barcodeValues.length) {
      throw new CatalogError('Product barcodes must be unique')
    }
    const attributeNames = input.attributes.map((item) =>
      item.name.toLowerCase(),
    )
    if (new Set(attributeNames).size !== attributeNames.length) {
      throw new CatalogError('Product attribute names must be unique')
    }
    const conversionIds = input.conversions.map((item) => item.unitId)
    if (new Set(conversionIds).size !== conversionIds.length) {
      throw new CatalogError('Product conversion units must be unique')
    }
    const imagePaths = input.images.map((item) => item.filePath)
    if (new Set(imagePaths).size !== imagePaths.length) {
      throw new CatalogError('Product image paths must be unique')
    }
  }

  private async replaceProductDetails(
    productId: string,
    input: z.infer<typeof productInputSchema>,
    now: string,
    executor: SqlExecutor,
  ): Promise<void> {
    for (const barcode of input.barcodes) {
      if (
        await this.repository.hasProductBarcode(barcode.barcode, executor)
      ) {
        throw new CatalogError('A barcode is already assigned to a product')
      }
      await this.repository.createProductBarcode(
        {
          id: createUuid(),
          productId,
          barcode: barcode.barcode,
          unitId: barcode.unitId ?? input.baseUnitId,
          createdAt: now,
        },
        executor,
      )
    }
    for (const attribute of input.attributes) {
      await this.repository.createProductAttribute(
        {
          id: createUuid(),
          productId,
          name: attribute.name,
          value: attribute.value,
          createdAt: now,
        },
        executor,
      )
    }
    for (const [index, image] of input.images.entries()) {
      await this.repository.createProductImage(
        {
          id: createUuid(),
          productId,
          filePath: image.filePath,
          mimeType: image.mimeType,
          sortOrder: image.sortOrder ?? index,
          createdAt: now,
        },
        executor,
      )
    }
    for (const conversion of input.conversions) {
      await this.repository.createProductConversion(
        {
          id: createUuid(),
          productId,
          unitId: conversion.unitId,
          factorToBase: conversion.factorToBase,
          createdAt: now,
        },
        executor,
      )
    }
  }

  private async loadProduct(
    row: SqlRow,
    executor: SqlExecutor,
  ): Promise<CatalogProduct> {
    const product = this.parseProduct(row)
    const [barcodes, attributes, images, conversions] = await Promise.all([
      this.repository.listProductBarcodes(product.id, executor),
      this.repository.listProductAttributes(product.id, executor),
      this.repository.listProductImages(product.id, executor),
      this.repository.listProductConversions(product.id, executor),
    ])
    return {
      ...product,
      barcodes: barcodes.map((row) => {
        const parsed = barcodeRowSchema.safeParse(row)
        if (!parsed.success) {
          throw new CatalogError('A product barcode record is invalid')
        }
        return {
          id: parsed.data.id,
          barcode: parsed.data.barcode,
          unitId: parsed.data.unit_id,
        }
      }),
      attributes: attributes.map((row) => {
        const parsed = attributeRowSchema.safeParse(row)
        if (!parsed.success) {
          throw new CatalogError('A product attribute record is invalid')
        }
        return {
          id: parsed.data.id,
          name: parsed.data.name,
          value: parsed.data.value,
        }
      }),
      images: images.map((row) => {
        const parsed = imageRowSchema.safeParse(row)
        if (!parsed.success) {
          throw new CatalogError('A product image record is invalid')
        }
        return {
          id: parsed.data.id,
          filePath: parsed.data.file_path,
          mimeType: parsed.data.mime_type,
          sortOrder: parsed.data.sort_order,
        }
      }),
      conversions: conversions.map((row) => {
        const parsed = conversionRowSchema.safeParse(row)
        if (!parsed.success) {
          throw new CatalogError('A product unit conversion record is invalid')
        }
        return {
          id: parsed.data.id,
          unitId: parsed.data.unit_id,
          factorToBase: parsed.data.factor_to_base,
        }
      }),
    }
  }

  private parseCategory(row: SqlRow): CatalogCategory {
    const parsed = categoryRowSchema.safeParse(row)
    if (!parsed.success) {
      throw new CatalogError('A category record is invalid')
    }
    return {
      id: parsed.data.id,
      parentId: parsed.data.parent_id,
      name: parsed.data.name,
      code: parsed.data.code,
      status: parsed.data.status,
      createdAt: parsed.data.created_at,
      updatedAt: parsed.data.updated_at,
    }
  }

  private parseBrand(row: SqlRow): CatalogBrand {
    const parsed = brandRowSchema.safeParse(row)
    if (!parsed.success) {
      throw new CatalogError('A brand record is invalid')
    }
    return {
      id: parsed.data.id,
      name: parsed.data.name,
      status: parsed.data.status,
      createdAt: parsed.data.created_at,
      updatedAt: parsed.data.updated_at,
    }
  }

  private parseUnit(row: SqlRow): MeasurementUnit {
    const parsed = unitRowSchema.safeParse(row)
    if (!parsed.success) {
      throw new CatalogError('A measurement unit record is invalid')
    }
    return {
      id: parsed.data.id,
      code: parsed.data.code,
      name: parsed.data.name,
      dimension: parsed.data.dimension,
      decimalPlaces: parsed.data.decimal_places,
      status: parsed.data.status,
      createdAt: parsed.data.created_at,
      updatedAt: parsed.data.updated_at,
    }
  }

  private parseProduct(row: SqlRow) {
    const parsed = productRowSchema.safeParse(row)
    if (!parsed.success) {
      throw new CatalogError('A product record is invalid')
    }
    return {
      id: parsed.data.id,
      sku: parsed.data.sku,
      name: parsed.data.name,
      categoryId: parsed.data.category_id,
      brandId: parsed.data.brand_id,
      description: parsed.data.description,
      baseUnitId: parsed.data.base_unit_id,
      purchasePrice: parsed.data.purchase_price,
      sellingPrice: parsed.data.selling_price,
      minimumStock: parsed.data.minimum_stock,
      status: parsed.data.status,
      createdAt: parsed.data.created_at,
      updatedAt: parsed.data.updated_at,
    }
  }

  private productFields(
    id: string,
    input: z.infer<typeof productInputSchema>,
    now: string,
  ) {
    return {
      id,
      sku: input.sku,
      name: input.name,
      categoryId: input.categoryId ?? null,
      brandId: input.brandId ?? null,
      description: input.description ?? null,
      baseUnitId: input.baseUnitId,
      purchasePrice: input.purchasePrice,
      sellingPrice: input.sellingPrice,
      minimumStock: input.minimumStock,
      status: input.status,
      createdAt: now,
    } as const
  }

  private productUpdateFields(input: z.infer<typeof productInputSchema>) {
    return {
      sku: input.sku,
      name: input.name,
      categoryId: input.categoryId ?? null,
      brandId: input.brandId ?? null,
      description: input.description ?? null,
      baseUnitId: input.baseUnitId,
      purchasePrice: input.purchasePrice,
      sellingPrice: input.sellingPrice,
      minimumStock: input.minimumStock,
      status: input.status,
    } as const
  }

  private productAuditData(input: z.infer<typeof productInputSchema>) {
    return {
      sku: input.sku,
      name: input.name,
      categoryId: input.categoryId ?? null,
      brandId: input.brandId ?? null,
      description: input.description ?? null,
      baseUnitId: input.baseUnitId,
      purchasePrice: input.purchasePrice,
      sellingPrice: input.sellingPrice,
      minimumStock: input.minimumStock,
      status: input.status,
      barcodes: input.barcodes,
      attributes: input.attributes,
      images: input.images,
      conversions: input.conversions,
    }
  }

  private async writeAudit(
    executor: SqlExecutor,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
    occurredAt: string,
  ): Promise<void> {
    await this.authRepository.writeAudit(
      {
        actorUserId: actorId,
        action,
        entityType,
        entityId,
        beforeData: before === null ? null : JSON.stringify(before),
        afterData: after === null ? null : JSON.stringify(after),
        occurredAt,
      },
      executor,
    )
  }

  private auditRow(row: SqlRow): unknown {
    return row
  }

}
