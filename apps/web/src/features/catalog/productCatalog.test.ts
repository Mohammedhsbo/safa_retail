// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../../infrastructure/database/setup'
import { SqliteDatabase } from '../../infrastructure/database/SqliteDatabase'
import { BetterSqliteTestDriver } from '../../test/database/BetterSqliteTestDriver'
import { AuthRepository } from '../auth/AuthRepository'
import { AuthenticationService } from '../auth/AuthenticationService'
import { AuthorizationError } from '../auth/auth.errors'
import { RoleManagementService } from '../auth/RoleManagementService'
import { UserManagementService } from '../auth/UserManagementService'
import type { PasswordHasher } from '../auth/auth.types'
import { ProductCatalogService } from './ProductCatalogService'
import { OrganizationService } from '../organization/OrganizationService'

class TestPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return createHash('sha256').update(password).digest('hex')
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    return (await this.hash(password)) === encodedHash
  }
}

let database: SqliteDatabase
let ownerId: string
let catalog: ProductCatalogService
let organization: OrganizationService
let branchId: string
let passwordHasher: PasswordHasher
let authentication: AuthenticationService
let units: Record<string, string>

async function createOwner() {
  const owner = await authentication.setupInitialOwner({
    username: 'owner',
    displayName: 'Owner',
    password: 'a-secure-owner-password',
  })
  ownerId = owner.id
}

async function createEmployee(
  username: string,
  permissions: Array<
    'products.read' | 'products.create' | 'products.update' | 'products.delete'
  > = [],
) {
  const roles = new RoleManagementService(database)
  const roleId = await roles.createRole(ownerId, `${username} role`)
  await roles.setPermissions(ownerId, roleId, permissions)
  const role = (await new AuthRepository(database).getRoles()).find(
    (item) => item.id === roleId,
  )
  if (!role) {
    throw new Error('The test role could not be loaded')
  }
  return new UserManagementService(database, passwordHasher).createUser(
    ownerId,
    {
      username,
      displayName: username,
      password: 'a-secure-test-password',
      roleCodes: [role.code],
      branchIds: [],
      warehouseIds: [],
    },
  )
}

async function createProduct(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  return catalog.createProduct(ownerId, {
    sku: 'FABRIC-1',
    name: 'Cotton Fabric',
    baseUnitId: units.M,
    purchasePrice: '12.30',
    sellingPrice: '18.75',
    minimumStock: '2.125',
    status: 'active',
    ...overrides,
  }, branchId)
}

beforeEach(async () => {
  database = new SqliteDatabase(new BetterSqliteTestDriver())
  await database.open()
  await initializeDatabase(database)
  passwordHasher = new TestPasswordHasher()
  authentication = new AuthenticationService(database, passwordHasher)
  catalog = new ProductCatalogService(database)
  organization = new OrganizationService(database)
  ownerId = ''
  await createOwner()
  branchId = await organization.createBranch(ownerId, {
    code: 'catalog',
    name: 'Catalog Branch',
  })
  await catalog.initializeStandardUnits(ownerId)
  const allUnits = await catalog.listUnits(ownerId)
  units = Object.fromEntries(allUnits.map((unit) => [unit.code, unit.id]))
})

afterEach(async () => {
  await database.close()
})

describe('product catalog', () => {
  it('creates dynamic categories and brands and prevents invalid hierarchy and unsafe archives', async () => {
    const fabricsId = await catalog.createCategory(ownerId, {
      name: 'Fabrics',
      code: 'fab',
    })
    const cottonId = await catalog.createCategory(ownerId, {
      name: 'Cotton',
      code: 'cotton',
      parentId: fabricsId,
    })
    const brandId = await catalog.createBrand(ownerId, { name: 'SAFA Textiles' })

    await expect(
      catalog.updateCategory(ownerId, fabricsId, {
        name: 'Fabrics',
        parentId: cottonId,
      }),
    ).rejects.toThrow(/cannot contain a cycle/)
    await expect(
      catalog.archiveCategory(ownerId, fabricsId),
    ).rejects.toThrow(/active child categories/)

    await catalog.updateCategory(ownerId, cottonId, {
      name: 'Cotton Cloth',
      code: 'cotton-cloth',
      parentId: fabricsId,
    })
    await catalog.updateBrand(ownerId, brandId, 'SAFA Fabrics')

    expect(await catalog.listCategories(ownerId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: fabricsId, code: 'FAB' }),
        expect.objectContaining({
          id: cottonId,
          name: 'Cotton Cloth',
          parentId: fabricsId,
        }),
      ]),
    )
    expect(await catalog.listBrands(ownerId)).toContainEqual(
      expect.objectContaining({ id: brandId, name: 'SAFA Fabrics' }),
    )
    await catalog.archiveCategory(ownerId, cottonId)
    await expect(
      catalog.createProduct(ownerId, {
        sku: 'ARCHIVED-CAT',
        name: 'Archived Category Product',
        categoryId: cottonId,
        baseUnitId: units.PC,
        purchasePrice: '1',
        sellingPrice: '2',
        minimumStock: '0',
      }, branchId),
    ).rejects.toThrow(/category must be active/)
  })

  it('initializes the requested standard units idempotently and supports custom fractional units', async () => {
    const before = await catalog.listUnits(ownerId)
    await database.withTransaction((transaction) =>
      transaction.run('DELETE FROM measurement_units WHERE code = ?', ['TOP']),
    )
    await catalog.initializeStandardUnits(ownerId)
    const after = await catalog.listUnits(ownerId)
    expect(after).toHaveLength(before.length)
    expect(after.map((unit) => unit.name)).toEqual(
      expect.arrayContaining([
        'Piece',
        'Package',
        'Carton',
        'Kilogram',
        'Ton',
        'Liter',
        'Milliliter',
        'Meter',
        'Roll',
        'التوب',
        'Bundle',
      ]),
    )
    expect(after.find((unit) => unit.code === 'TOP')).toMatchObject({
      name: 'التوب',
      dimension: 'count',
      decimalPlaces: 0,
    })
    expect(after.find((unit) => unit.code === 'KG')).toMatchObject({
      dimension: 'mass',
      decimalPlaces: 3,
    })
    expect(after.find((unit) => unit.code === 'L')).toMatchObject({
      dimension: 'volume',
      decimalPlaces: 3,
    })

    const customId = await catalog.createUnit(ownerId, {
      code: 'YARD',
      name: 'Yard',
      dimension: 'length',
      decimalPlaces: 2,
    })
    expect(await catalog.listUnits(ownerId)).toContainEqual(
      expect.objectContaining({
        id: customId,
        code: 'YARD',
        decimalPlaces: 2,
        status: 'active',
      }),
    )
  })

  it('adds missing standard pricing units for product editors', async () => {
    const editorId = await createEmployee('product-editor', ['products.update'])
    await database.withTransaction((transaction) =>
      transaction.run('DELETE FROM measurement_units WHERE code = ?', ['TOP']),
    )

    await catalog.initializeStandardUnits(editorId)

    expect(await catalog.listUnits(ownerId)).toContainEqual(
      expect.objectContaining({
        code: 'TOP',
        name: 'التوب',
        dimension: 'count',
        decimalPlaces: 0,
      }),
    )
  })

  it('creates a fully described product with exact decimal values and explicit product-specific units', async () => {
    const categoryId = await catalog.createCategory(ownerId, {
      name: 'Fabrics',
    })
    const brandId = await catalog.createBrand(ownerId, {
      name: 'SAFA Fabrics',
    })
    const cartonId = units.CTN
    const productId = await createProduct({
      categoryId,
      brandId,
      description: 'Cotton, width 150 cm',
      barcodes: [
        { barcode: '890000001', unitId: units.M },
        { barcode: '890000002', unitId: cartonId },
      ],
      attributes: [
        { name: 'Material', value: 'Cotton' },
        { name: 'Width', value: '150 cm' },
        { name: 'Color', value: 'Blue' },
      ],
      images: [
        {
          filePath: 'products/fabric-front.webp',
          mimeType: 'image/webp',
          sortOrder: 0,
        },
      ],
      conversions: [{ unitId: cartonId, factorToBase: '25' }],
    })

    const product = await catalog.getProduct(ownerId, productId)
    expect(product).toMatchObject({
      id: productId,
      sku: 'FABRIC-1',
      categoryId,
      brandId,
      description: 'Cotton, width 150 cm',
      baseUnitId: units.M,
      purchasePrice: '12.30',
      sellingPrice: '18.75',
      minimumStock: '2.125',
      status: 'active',
    })
    expect(product?.barcodes).toHaveLength(2)
    expect(product?.attributes).toHaveLength(3)
    expect(product?.images).toEqual([
      expect.objectContaining({
        filePath: 'products/fabric-front.webp',
        mimeType: 'image/webp',
        sortOrder: 0,
      }),
    ])
    expect(product?.conversions).toEqual([
      expect.objectContaining({
        unitId: cartonId,
        factorToBase: '25',
      }),
    ])
    await expect(catalog.archiveCategory(ownerId, categoryId)).rejects.toThrow(
      /still assigned to products/,
    )
    await expect(catalog.archiveBrand(ownerId, brandId)).rejects.toThrow(
      /still assigned to products/,
    )
    expect(await catalog.getProductByBarcode(ownerId, '890000002')).toEqual(
      product,
    )

    const noConversionProduct = await createProduct({
      sku: 'LIQUID-1',
      name: 'Liquid Cleaner',
      baseUnitId: units.L,
      minimumStock: '0.5',
    })
    expect(
      (await catalog.getProduct(ownerId, noConversionProduct))?.conversions,
    ).toEqual([])
  })

  it('updates product details atomically, supports inactive state, and archives without deleting', async () => {
    const productId = await createProduct({
      barcodes: [{ barcode: 'OLD-CODE' }],
      attributes: [{ name: 'Color', value: 'Blue' }],
      conversions: [{ unitId: units.ROLL, factorToBase: '20' }],
    })
    await createProduct({
      sku: 'FABRIC-2',
      name: 'Second Fabric',
      barcodes: [{ barcode: 'OTHER-PRODUCT-CODE' }],
    })
    const existing = (await catalog.getProduct(ownerId, productId))!

    await expect(
      catalog.updateProduct(ownerId, productId, {
        ...existing,
        barcodes: [{ barcode: 'OTHER-PRODUCT-CODE' }],
      }),
    ).rejects.toThrow(/already assigned/)
    expect(await catalog.getProductByBarcode(ownerId, 'OLD-CODE')).toMatchObject({
      id: productId,
    })

    await catalog.updateProduct(ownerId, productId, {
      sku: 'FABRIC-UPDATED',
      name: 'Updated Fabric',
      baseUnitId: units.M,
      purchasePrice: '14.05',
      sellingPrice: '20.90',
      minimumStock: '3.500',
      status: 'inactive',
      barcodes: [{ barcode: 'NEW-CODE' }],
      attributes: [{ name: 'Color', value: 'Red' }],
      images: [],
      conversions: [],
    })
    expect(await catalog.getProductByBarcode(ownerId, 'OLD-CODE')).toBeNull()
    expect(await catalog.getProductByBarcode(ownerId, 'NEW-CODE')).toBeNull()
    expect(await catalog.getProduct(ownerId, productId)).toMatchObject({
      sku: 'FABRIC-UPDATED',
      status: 'inactive',
      purchasePrice: '14.05',
      sellingPrice: '20.90',
      minimumStock: '3.500',
      attributes: [{ name: 'Color', value: 'Red' }],
      conversions: [],
    })

    await catalog.setProductStatus(ownerId, productId, 'active')
    await expect(
      catalog.getProductByBarcode(ownerId, 'NEW-CODE'),
    ).resolves.toMatchObject({ id: productId })
    await catalog.archiveProduct(ownerId, productId)
    expect(await catalog.getProduct(ownerId, productId)).toMatchObject({
      id: productId,
      status: 'archived',
    })
    expect(await catalog.listProducts(ownerId)).toContainEqual(
      expect.objectContaining({ id: productId, status: 'archived' }),
    )
  })

  it('validates decimal strings, fractional unit precision, unit references, and safe image paths', async () => {
    await expect(
      createProduct({ purchasePrice: '1e3' }),
    ).rejects.toThrow(/details are invalid/)
    await expect(
      createProduct({
        baseUnitId: units.PC!,
        minimumStock: '0.5',
      }),
    ).rejects.toThrow(/base unit precision/)
    await expect(
      createProduct({
        images: [
          {
            filePath: 'products/../../secret.png',
            mimeType: 'image/png',
          },
        ],
      }),
    ).rejects.toThrow(/details are invalid/)
    const liquidProductId = await createProduct({
      sku: 'LIQUID-2',
      name: 'Another Liquid',
      baseUnitId: units.L!,
    })
    expect(
      (await catalog.getProduct(ownerId, liquidProductId))?.conversions,
    ).toEqual([])
    await expect(catalog.archiveUnit(ownerId, units.L!)).rejects.toThrow(
      /products or transactions reference it/,
    )

    const customUnit = await catalog.createUnit(ownerId, {
      code: 'CASE',
      name: 'Case',
      dimension: 'count',
      decimalPlaces: 0,
    })
    await catalog.updateUnit(ownerId, customUnit, {
      code: 'CASE',
      name: 'Case Pack',
      dimension: 'count',
      decimalPlaces: 0,
    })
    await catalog.archiveUnit(ownerId, customUnit)
    await expect(
      createProduct({ baseUnitId: customUnit }),
    ).rejects.toThrow(/base measurement unit must be active/)
  })

  it('enforces catalog permissions and maintains audit records for mutations', async () => {
    const readerId = await createEmployee('reader', ['products.read'])
    await expect(
      catalog.createCategory(readerId, { name: 'No Permission' }),
    ).rejects.toThrow(AuthorizationError)
    await expect(catalog.listCategories(readerId)).resolves.toEqual([])

    const authorId = await createEmployee('author', ['products.create'])
    const categoryId = await catalog.createCategory(authorId, {
      name: 'Allowed Category',
    })
    await expect(
      catalog.updateCategory(authorId, categoryId, {
        name: 'Not Allowed',
      }),
    ).rejects.toThrow(AuthorizationError)

    await createProduct()
    const audits = await database.query<{ action: string }>(
      'SELECT action FROM audit_logs ORDER BY occurred_at',
    )
    expect(audits.map((row) => row.action)).toContain('category.created')
    expect(audits.map((row) => row.action)).toContain('product.created')
  })

  it('limits product availability and catalog reads to the selected authorized branch', async () => {
    const secondBranchId = await organization.createBranch(ownerId, {
      code: 'catalog-2',
      name: 'Second Catalog Branch',
    })
    const productId = await createProduct({ sku: 'BRANCH-ONLY' })
    expect(await catalog.listProducts(ownerId, branchId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: productId })]),
    )
    expect(await catalog.listProducts(ownerId, secondBranchId)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: productId })]),
    )
    await expect(
      catalog.getProduct(ownerId, productId, secondBranchId),
    ).resolves.toBeNull()

    const employeeId = await createEmployee('branch-reader', ['products.read'])
    await new UserManagementService(database, passwordHasher).setUserAccess(
      ownerId,
      employeeId,
      [branchId],
      [],
    )
    await expect(
      catalog.listProducts(employeeId, secondBranchId),
    ).rejects.toThrow(AuthorizationError)
    await expect(catalog.getProduct(employeeId, productId, branchId))
      .resolves.toMatchObject({ id: productId })
  })

  it('keeps product assignment and pricing isolated to each warehouse', async () => {
    const firstWarehouseId = await organization.createWarehouse(ownerId, {
      branchId,
      code: 'first',
      name: 'First Warehouse',
      warehouseType: 'fabrics',
    })
    const secondWarehouseId = await organization.createWarehouse(ownerId, {
      branchId,
      code: 'second',
      name: 'Second Warehouse',
      warehouseType: 'fabrics',
    })
    const productId = await createProduct({ sku: 'WAREHOUSE-ONLY' })

    await catalog.assignProductToWarehouse(
      ownerId,
      productId,
      branchId,
      firstWarehouseId,
    )
    expect(await catalog.listProducts(ownerId, branchId, firstWarehouseId))
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: productId })]))
    expect(await catalog.listProducts(ownerId, branchId, secondWarehouseId))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: productId })]))
    expect(await catalog.listProductsNotInWarehouse(ownerId, branchId, secondWarehouseId))
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: productId })]))

    const firstWarehouseProduct = await catalog.getProduct(
      ownerId,
      productId,
      branchId,
      firstWarehouseId,
    )
    expect(firstWarehouseProduct).not.toBeNull()
    if (!firstWarehouseProduct) throw new Error('Assigned product was not loaded')
    await catalog.updateProduct(ownerId, productId, {
      sku: firstWarehouseProduct.sku,
      name: firstWarehouseProduct.name,
      categoryId: firstWarehouseProduct.categoryId,
      brandId: firstWarehouseProduct.brandId,
      description: firstWarehouseProduct.description,
      baseUnitId: firstWarehouseProduct.baseUnitId,
      purchasePrice: firstWarehouseProduct.purchasePrice,
      sellingPrice: '25',
      minimumStock: firstWarehouseProduct.minimumStock,
      status: firstWarehouseProduct.status,
      barcodes: firstWarehouseProduct.barcodes,
      attributes: firstWarehouseProduct.attributes,
      images: firstWarehouseProduct.images,
      conversions: firstWarehouseProduct.conversions,
    }, branchId, firstWarehouseId)
    await catalog.assignProductToWarehouse(
      ownerId,
      productId,
      branchId,
      secondWarehouseId,
    )

    expect(await catalog.getProduct(ownerId, productId, branchId, firstWarehouseId))
      .toMatchObject({ sellingPrice: '25' })
    expect(await catalog.getProduct(ownerId, productId, branchId, secondWarehouseId))
      .toMatchObject({ sellingPrice: '18.75' })
  })
})
