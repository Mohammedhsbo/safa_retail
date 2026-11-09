import type { SqlExecutor, SqlRow } from '../../infrastructure/database/types'

export class ProductCatalogRepository {
  private readonly database: SqlExecutor

  constructor(database: SqlExecutor) {
    this.database = database
  }

  async listCategories(executor: SqlExecutor = this.database): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, parent_id, name, code, status, created_at, updated_at
       FROM categories ORDER BY name`,
    )
  }

  async getCategory(
    categoryId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, parent_id, name, code, status, created_at, updated_at
       FROM categories WHERE id = ?`,
      [categoryId],
    )
    return row ?? null
  }

  async createCategory(
    input: {
      id: string
      parentId: string | null
      name: string
      code: string | null
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO categories
         (id, parent_id, name, code, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      [
        input.id,
        input.parentId,
        input.name,
        input.code,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async updateCategory(
    categoryId: string,
    input: { parentId: string | null; name: string; code: string | null },
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `UPDATE categories
       SET parent_id = ?, name = ?, code = ?, updated_at = ?
       WHERE id = ? AND status = 'active'`,
      [input.parentId, input.name, input.code, updatedAt, categoryId],
    )
  }

  async archiveCategory(
    categoryId: string,
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      "UPDATE categories SET status = 'archived', updated_at = ? WHERE id = ?",
      [updatedAt, categoryId],
    )
  }

  async listBrands(executor: SqlExecutor = this.database): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, name, status, created_at, updated_at
       FROM brands ORDER BY name`,
    )
  }

  async getBrand(
    brandId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, name, status, created_at, updated_at
       FROM brands WHERE id = ?`,
      [brandId],
    )
    return row ?? null
  }

  async createBrand(
    input: { id: string; name: string; createdAt: string },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO brands (id, name, status, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?)`,
      [input.id, input.name, input.createdAt, input.createdAt],
    )
  }

  async updateBrand(
    brandId: string,
    name: string,
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      "UPDATE brands SET name = ?, updated_at = ? WHERE id = ? AND status = 'active'",
      [name, updatedAt, brandId],
    )
  }

  async archiveBrand(
    brandId: string,
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      "UPDATE brands SET status = 'archived', updated_at = ? WHERE id = ?",
      [updatedAt, brandId],
    )
  }

  async listUnits(executor: SqlExecutor = this.database): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, code, name, dimension, decimal_places, status,
              created_at, updated_at
       FROM measurement_units ORDER BY name`,
    )
  }

  async getUnit(
    unitId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, code, name, dimension, decimal_places, status,
              created_at, updated_at
       FROM measurement_units WHERE id = ?`,
      [unitId],
    )
    return row ?? null
  }

  async createUnit(
    input: {
      id: string
      code: string
      name: string
      dimension: string
      decimalPlaces: number
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO measurement_units
         (id, code, name, dimension, decimal_places, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        input.id,
        input.code,
        input.name,
        input.dimension,
        input.decimalPlaces,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async updateUnit(
    unitId: string,
    input: {
      code: string
      name: string
      dimension: string
      decimalPlaces: number
    },
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `UPDATE measurement_units
       SET code = ?, name = ?, dimension = ?, decimal_places = ?, updated_at = ?
       WHERE id = ? AND status = 'active'`,
      [
        input.code,
        input.name,
        input.dimension,
        input.decimalPlaces,
        updatedAt,
        unitId,
      ],
    )
  }

  async archiveUnit(
    unitId: string,
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      "UPDATE measurement_units SET status = 'archived', updated_at = ? WHERE id = ?",
      [updatedAt, unitId],
    )
  }

  async unitIsReferenced(
    unitId: string,
    executor: SqlExecutor = this.database,
  ): Promise<boolean> {
    const [row] = await executor.query<{ is_referenced: number }>(
      `SELECT (
         EXISTS (SELECT 1 FROM products WHERE base_unit_id = ?) OR
         EXISTS (SELECT 1 FROM product_barcodes WHERE unit_id = ?) OR
         EXISTS (SELECT 1 FROM product_unit_conversions WHERE unit_id = ?) OR
         EXISTS (SELECT 1 FROM sale_items WHERE unit_id = ?) OR
         EXISTS (SELECT 1 FROM purchase_items WHERE unit_id = ?) OR
         EXISTS (SELECT 1 FROM inventory_movements WHERE unit_id = ?) OR
         EXISTS (SELECT 1 FROM stock_transfer_items WHERE unit_id = ?) OR
         EXISTS (SELECT 1 FROM stock_count_items WHERE unit_id = ?) OR
         EXISTS (SELECT 1 FROM manufacturing_materials WHERE unit_id = ?) OR
         EXISTS (SELECT 1 FROM production_outputs WHERE unit_id = ?)
       ) AS is_referenced`,
      [
        unitId,
        unitId,
        unitId,
        unitId,
        unitId,
        unitId,
        unitId,
        unitId,
        unitId,
        unitId,
      ],
    )
    return row?.is_referenced === 1
  }

  async createProduct(
    input: {
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
      status: 'active' | 'inactive'
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO products
         (id, sku, name, category_id, brand_id, description, base_unit_id,
          purchase_price, selling_price, minimum_stock, attributes, status,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
      [
        input.id,
        input.sku,
        input.name,
        input.categoryId,
        input.brandId,
        input.description,
        input.baseUnitId,
        input.purchasePrice,
        input.sellingPrice,
        input.minimumStock,
        input.status,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async updateProduct(
    productId: string,
    input: {
      sku: string
      name: string
      categoryId: string | null
      brandId: string | null
      description: string | null
      baseUnitId: string
      purchasePrice: string
      sellingPrice: string
      minimumStock: string
      status: 'active' | 'inactive'
    },
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `UPDATE products
       SET sku = ?, name = ?, category_id = ?, brand_id = ?, description = ?,
           base_unit_id = ?, purchase_price = ?, selling_price = ?,
           minimum_stock = ?, status = ?, updated_at = ?
       WHERE id = ? AND status <> 'archived'`,
      [
        input.sku,
        input.name,
        input.categoryId,
        input.brandId,
        input.description,
        input.baseUnitId,
        input.purchasePrice,
        input.sellingPrice,
        input.minimumStock,
        input.status,
        updatedAt,
        productId,
      ],
    )
  }

  async setProductStatus(
    productId: string,
    status: 'active' | 'inactive' | 'archived',
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      "UPDATE products SET status = ?, updated_at = ? WHERE id = ? AND status <> 'archived'",
      [status, updatedAt, productId],
    )
  }

  async getProduct(
    productId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT id, sku, name, category_id, brand_id, description, base_unit_id,
              purchase_price, selling_price, minimum_stock, status,
              created_at, updated_at
       FROM products WHERE id = ?`,
      [productId],
    )
    return row ?? null
  }

  async getProductByBarcode(
    barcode: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT p.id, p.sku, p.name, p.category_id, p.brand_id, p.description,
              p.base_unit_id, p.purchase_price, p.selling_price,
              p.minimum_stock, p.status, p.created_at, p.updated_at
       FROM product_barcodes pb
       JOIN products p ON p.id = pb.product_id
       WHERE pb.barcode = ? AND p.status = 'active'`,
      [barcode],
    )
    return row ?? null
  }

  async getProductForBranch(
    productId: string,
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT p.id, p.sku, p.name, p.category_id, p.brand_id, p.description,
              p.base_unit_id, a.purchase_price, a.selling_price,
              a.minimum_stock, p.status, p.created_at, p.updated_at
       FROM products p
       JOIN product_branch_availability a ON a.product_id = p.id
       WHERE p.id = ? AND a.branch_id = ? AND a.status = 'active'`,
      [productId, branchId],
    )
    return row ?? null
  }

  async getProductByBarcodeForBranch(
    barcode: string,
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow | null> {
    const [row] = await executor.query(
      `SELECT p.id, p.sku, p.name, p.category_id, p.brand_id, p.description,
              p.base_unit_id, a.purchase_price, a.selling_price,
              a.minimum_stock, p.status, p.created_at, p.updated_at
       FROM product_barcodes pb
       JOIN products p ON p.id = pb.product_id
       JOIN product_branch_availability a ON a.product_id = p.id
       WHERE pb.barcode = ? AND a.branch_id = ? AND a.status = 'active'
         AND p.status = 'active'`,
      [barcode, branchId],
    )
    return row ?? null
  }

  async listProductsForBranch(
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT p.id, p.sku, p.name, p.category_id, p.brand_id, p.description,
              p.base_unit_id, a.purchase_price, a.selling_price,
              a.minimum_stock, p.status, p.created_at, p.updated_at
       FROM products p
       JOIN product_branch_availability a ON a.product_id = p.id
       WHERE a.branch_id = ? AND a.status = 'active' AND p.status <> 'archived'
       ORDER BY p.name, p.sku`,
      [branchId],
    )
  }

  async hasProductBranchAvailability(
    productId: string,
    branchId: string,
    executor: SqlExecutor = this.database,
  ): Promise<boolean> {
    const [row] = await executor.query<{ is_available: number }>(
      `SELECT EXISTS (
         SELECT 1 FROM product_branch_availability
         WHERE product_id = ? AND branch_id = ? AND status = 'active'
       ) AS is_available`,
      [productId, branchId],
    )
    return row?.is_available === 1
  }

  async createProductBranchAvailability(
    input: {
      productId: string
      branchId: string
      purchasePrice: string
      sellingPrice: string
      minimumStock: string
      status: 'active' | 'inactive'
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO product_branch_availability
         (product_id, branch_id, purchase_price, selling_price, minimum_stock,
          status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.productId,
        input.branchId,
        input.purchasePrice,
        input.sellingPrice,
        input.minimumStock,
        input.status,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async updateProductBranchAvailability(
    productId: string,
    branchId: string,
    input: { purchasePrice: string; sellingPrice: string; minimumStock: string },
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `UPDATE product_branch_availability
       SET purchase_price = ?, selling_price = ?, minimum_stock = ?, updated_at = ?
       WHERE product_id = ? AND branch_id = ? AND status = 'active'`,
      [
        input.purchasePrice,
        input.sellingPrice,
        input.minimumStock,
        updatedAt,
        productId,
        branchId,
      ],
    )
  }

  async setProductBranchAvailabilityStatus(
    productId: string,
    branchId: string,
    status: 'active' | 'inactive',
    updatedAt: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      'UPDATE product_branch_availability SET status = ?, updated_at = ? WHERE product_id = ? AND branch_id = ?',
      [status, updatedAt, productId, branchId],
    )
  }

  async listProducts(executor: SqlExecutor = this.database): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, sku, name, category_id, brand_id, description, base_unit_id,
              purchase_price, selling_price, minimum_stock, status,
              created_at, updated_at
       FROM products ORDER BY name, sku`,
    )
  }

  async listProductBarcodes(
    productId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, product_id, barcode, unit_id, created_at
       FROM product_barcodes WHERE product_id = ? ORDER BY barcode`,
      [productId],
    )
  }

  async listProductAttributes(
    productId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, product_id, name, value, created_at, updated_at
       FROM product_attributes WHERE product_id = ? ORDER BY name`,
      [productId],
    )
  }

  async listProductImages(
    productId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, product_id, file_path, mime_type, sort_order, created_at
       FROM product_images WHERE product_id = ? ORDER BY sort_order, file_path`,
      [productId],
    )
  }

  async listProductConversions(
    productId: string,
    executor: SqlExecutor = this.database,
  ): Promise<SqlRow[]> {
    return executor.query(
      `SELECT id, product_id, unit_id, factor_to_base, created_at, updated_at
       FROM product_unit_conversions WHERE product_id = ? ORDER BY unit_id`,
      [productId],
    )
  }

  async createProductBarcode(
    input: {
      id: string
      productId: string
      barcode: string
      unitId: string | null
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO product_barcodes
         (id, product_id, barcode, unit_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [input.id, input.productId, input.barcode, input.unitId, input.createdAt],
    )
  }

  async createProductAttribute(
    input: {
      id: string
      productId: string
      name: string
      value: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO product_attributes
         (id, product_id, name, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.productId,
        input.name,
        input.value,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async createProductImage(
    input: {
      id: string
      productId: string
      filePath: string
      mimeType: string
      sortOrder: number
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO product_images
         (id, product_id, file_path, mime_type, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.productId,
        input.filePath,
        input.mimeType,
        input.sortOrder,
        input.createdAt,
      ],
    )
  }

  async createProductConversion(
    input: {
      id: string
      productId: string
      unitId: string
      factorToBase: string
      createdAt: string
    },
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run(
      `INSERT INTO product_unit_conversions
         (id, product_id, unit_id, factor_to_base, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.productId,
        input.unitId,
        input.factorToBase,
        input.createdAt,
        input.createdAt,
      ],
    )
  }

  async deleteProductDetails(
    productId: string,
    executor: SqlExecutor = this.database,
  ): Promise<void> {
    await executor.run('DELETE FROM product_barcodes WHERE product_id = ?', [
      productId,
    ])
    await executor.run('DELETE FROM product_attributes WHERE product_id = ?', [
      productId,
    ])
    await executor.run('DELETE FROM product_images WHERE product_id = ?', [
      productId,
    ])
    await executor.run(
      'DELETE FROM product_unit_conversions WHERE product_id = ?',
      [productId],
    )
  }

  async hasProductBarcode(
    barcode: string,
    executor: SqlExecutor = this.database,
  ): Promise<boolean> {
    const rows = await executor.query(
      'SELECT 1 AS exists_barcode FROM product_barcodes WHERE barcode = ?',
      [barcode],
    )
    return rows.length > 0
  }

}
