export const branchProductAvailabilityStatements = [
  'ALTER TABLE warehouses ADD COLUMN warehouse_type TEXT',
  'ALTER TABLE warehouses ADD COLUMN address TEXT',
  'ALTER TABLE warehouses ADD COLUMN description TEXT',
  'ALTER TABLE warehouses ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))',
  `CREATE TABLE product_branch_availability (
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    purchase_price TEXT NOT NULL,
    selling_price TEXT NOT NULL,
    minimum_stock TEXT NOT NULL DEFAULT '0',
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (product_id, branch_id)
  )`,
  `INSERT INTO product_branch_availability
     (product_id, branch_id, purchase_price, selling_price, minimum_stock,
      status, created_at, updated_at)
   SELECT p.id, b.id, p.purchase_price, p.selling_price, p.minimum_stock,
          CASE WHEN p.status = 'active' THEN 'active' ELSE 'inactive' END,
          p.created_at, p.updated_at
   FROM products p CROSS JOIN branches b
   WHERE p.status <> 'archived' AND b.status = 'active'`,
  'CREATE INDEX idx_product_branch_availability_branch ON product_branch_availability(branch_id, status, product_id)',
] as const
