export const initialSchemaStatements = [
  `CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE roles (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE permissions (
    code TEXT PRIMARY KEY NOT NULL,
    description TEXT NOT NULL
  )`,
  `CREATE TABLE user_roles (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    PRIMARY KEY (user_id, role_id)
  )`,
  `CREATE TABLE role_permissions (
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE RESTRICT,
    PRIMARY KEY (role_id, permission_code)
  )`,
  `CREATE TABLE user_branch_access (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    PRIMARY KEY (user_id, branch_id)
  )`,
  `CREATE TABLE user_warehouse_access (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    PRIMARY KEY (user_id, warehouse_id)
  )`,
  `CREATE TABLE business_activities (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE branches (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE warehouses (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (branch_id, code),
    UNIQUE (id, branch_id)
  )`,
  `CREATE TABLE categories (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    parent_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    code TEXT UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE brands (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE measurement_units (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    dimension TEXT NOT NULL,
    decimal_places INTEGER NOT NULL DEFAULT 0 CHECK (decimal_places BETWEEN 0 AND 9),
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE products (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
    brand_id TEXT REFERENCES brands(id) ON DELETE RESTRICT,
    description TEXT,
    base_unit_id TEXT NOT NULL REFERENCES measurement_units(id) ON DELETE RESTRICT,
    purchase_price TEXT NOT NULL,
    selling_price TEXT NOT NULL,
    minimum_stock TEXT NOT NULL DEFAULT '0',
    attributes TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE product_barcodes (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    barcode TEXT NOT NULL UNIQUE,
    unit_id TEXT REFERENCES measurement_units(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    UNIQUE (id, product_id)
  )`,
  `CREATE TABLE product_attributes (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (product_id, name)
  )`,
  `CREATE TABLE product_images (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    file_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at TEXT NOT NULL,
    UNIQUE (product_id, file_path)
  )`,
  `CREATE TABLE product_unit_conversions (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    unit_id TEXT NOT NULL REFERENCES measurement_units(id) ON DELETE RESTRICT,
    factor_to_base TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (product_id, unit_id)
  )`,
  `CREATE TABLE customers (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    notes TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE suppliers (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    notes TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE sales (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    customer_id TEXT REFERENCES customers(id) ON DELETE RESTRICT,
    invoice_number TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'partially_returned', 'returned', 'cancelled')),
    subtotal TEXT NOT NULL,
    discount_total TEXT NOT NULL DEFAULT '0',
    tax_total TEXT NOT NULL DEFAULT '0',
    total TEXT NOT NULL,
    notes TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (branch_id, invoice_number),
    FOREIGN KEY (warehouse_id, branch_id) REFERENCES warehouses(id, branch_id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE sale_items (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    unit_id TEXT NOT NULL REFERENCES measurement_units(id) ON DELETE RESTRICT,
    quantity TEXT NOT NULL,
    unit_price TEXT NOT NULL,
    discount_total TEXT NOT NULL DEFAULT '0',
    tax_total TEXT NOT NULL DEFAULT '0',
    line_total TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE sale_payments (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
    amount TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    reference TEXT,
    received_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    paid_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE sales_returns (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
    return_number TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
    reason TEXT NOT NULL,
    refund_total TEXT NOT NULL DEFAULT '0',
    created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (sale_id, return_number)
  )`,
  `CREATE TABLE sales_return_items (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    return_id TEXT NOT NULL REFERENCES sales_returns(id) ON DELETE RESTRICT,
    sale_item_id TEXT NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,
    quantity TEXT NOT NULL,
    refund_amount TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE purchases (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    invoice_number TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'received', 'partially_returned', 'returned', 'cancelled')),
    subtotal TEXT NOT NULL,
    discount_total TEXT NOT NULL DEFAULT '0',
    tax_total TEXT NOT NULL DEFAULT '0',
    total TEXT NOT NULL,
    notes TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    received_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (branch_id, invoice_number),
    FOREIGN KEY (warehouse_id, branch_id) REFERENCES warehouses(id, branch_id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE purchase_items (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    unit_id TEXT NOT NULL REFERENCES measurement_units(id) ON DELETE RESTRICT,
    quantity TEXT NOT NULL,
    unit_cost TEXT NOT NULL,
    discount_total TEXT NOT NULL DEFAULT '0',
    tax_total TEXT NOT NULL DEFAULT '0',
    line_total TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE purchase_payments (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
    amount TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    reference TEXT,
    paid_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    paid_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE purchase_returns (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
    return_number TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
    reason TEXT NOT NULL,
    refund_total TEXT NOT NULL DEFAULT '0',
    created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (purchase_id, return_number)
  )`,
  `CREATE TABLE purchase_return_items (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    return_id TEXT NOT NULL REFERENCES purchase_returns(id) ON DELETE RESTRICT,
    purchase_item_id TEXT NOT NULL REFERENCES purchase_items(id) ON DELETE RESTRICT,
    quantity TEXT NOT NULL,
    refund_amount TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE inventory_movements (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    movement_type TEXT NOT NULL,
    quantity TEXT NOT NULL,
    unit_id TEXT NOT NULL REFERENCES measurement_units(id) ON DELETE RESTRICT,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE inventory_balances (
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    on_hand_quantity TEXT NOT NULL DEFAULT '0',
    reserved_quantity TEXT NOT NULL DEFAULT '0',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (product_id, warehouse_id)
  )`,
  `CREATE TABLE stock_transfers (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    transfer_number TEXT NOT NULL UNIQUE,
    from_branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    from_warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    to_branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    to_warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('draft', 'pending_approval', 'approved', 'in_transit', 'received', 'cancelled')),
    notes TEXT,
    requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    received_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (from_warehouse_id <> to_warehouse_id),
    FOREIGN KEY (from_warehouse_id, from_branch_id) REFERENCES warehouses(id, branch_id) ON DELETE RESTRICT,
    FOREIGN KEY (to_warehouse_id, to_branch_id) REFERENCES warehouses(id, branch_id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE stock_transfer_items (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    transfer_id TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE RESTRICT,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    unit_id TEXT NOT NULL REFERENCES measurement_units(id) ON DELETE RESTRICT,
    quantity TEXT NOT NULL,
    received_quantity TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE stock_counts (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    count_number TEXT NOT NULL UNIQUE,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('draft', 'counting', 'approved', 'cancelled')),
    counted_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE stock_count_items (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    stock_count_id TEXT NOT NULL REFERENCES stock_counts(id) ON DELETE RESTRICT,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    expected_quantity TEXT NOT NULL,
    counted_quantity TEXT,
    unit_id TEXT NOT NULL REFERENCES measurement_units(id) ON DELETE RESTRICT,
    notes TEXT,
    UNIQUE (stock_count_id, product_id)
  )`,
  `CREATE TABLE expenses (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    category TEXT NOT NULL,
    amount TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
    incurred_at TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE cashboxes (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (branch_id, code),
    UNIQUE (id, branch_id)
  )`,
  `CREATE TABLE cash_movements (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    cashbox_id TEXT NOT NULL REFERENCES cashboxes(id) ON DELETE RESTRICT,
    movement_type TEXT NOT NULL,
    amount TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE manufacturing_orders (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    order_number TEXT NOT NULL UNIQUE,
    branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    finished_product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    planned_quantity TEXT NOT NULL,
    actual_quantity TEXT,
    waste_quantity TEXT,
    status TEXT NOT NULL CHECK (status IN ('draft', 'planned', 'in_progress', 'completed', 'approved', 'cancelled')),
    notes TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (warehouse_id, branch_id) REFERENCES warehouses(id, branch_id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE manufacturing_materials (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    order_id TEXT NOT NULL REFERENCES manufacturing_orders(id) ON DELETE RESTRICT,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    unit_id TEXT NOT NULL REFERENCES measurement_units(id) ON DELETE RESTRICT,
    planned_quantity TEXT NOT NULL,
    consumed_quantity TEXT,
    unit_cost TEXT,
    consumed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE manufacturing_costs (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    order_id TEXT NOT NULL REFERENCES manufacturing_orders(id) ON DELETE RESTRICT,
    cost_type TEXT NOT NULL,
    amount TEXT NOT NULL,
    description TEXT NOT NULL,
    incurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE production_stages (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    order_id TEXT NOT NULL REFERENCES manufacturing_orders(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (order_id, sequence)
  )`,
  `CREATE TABLE production_outputs (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    order_id TEXT NOT NULL REFERENCES manufacturing_orders(id) ON DELETE RESTRICT,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    unit_id TEXT NOT NULL REFERENCES measurement_units(id) ON DELETE RESTRICT,
    quantity TEXT NOT NULL,
    approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    approved_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    actor_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_data TEXT,
    after_data TEXT,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE application_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX idx_user_roles_role_id ON user_roles(role_id)',
  'CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_code)',
  'CREATE INDEX idx_business_activities_enabled ON business_activities(enabled)',
  'CREATE INDEX idx_warehouses_branch_id ON warehouses(branch_id)',
  'CREATE INDEX idx_products_category_id ON products(category_id)',
  'CREATE INDEX idx_products_brand_id ON products(brand_id)',
  'CREATE INDEX idx_products_status_name ON products(status, name)',
  'CREATE INDEX idx_product_barcodes_product_id ON product_barcodes(product_id)',
  'CREATE INDEX idx_product_attributes_product_id ON product_attributes(product_id)',
  'CREATE INDEX idx_product_images_product_order ON product_images(product_id, sort_order)',
  'CREATE INDEX idx_conversions_unit_id ON product_unit_conversions(unit_id)',
  'CREATE INDEX idx_customers_name ON customers(name)',
  'CREATE INDEX idx_suppliers_name ON suppliers(name)',
  'CREATE INDEX idx_sales_branch_date ON sales(branch_id, created_at)',
  'CREATE INDEX idx_sales_customer_date ON sales(customer_id, created_at)',
  'CREATE INDEX idx_sale_items_sale_id ON sale_items(sale_id)',
  'CREATE INDEX idx_sale_items_product_id ON sale_items(product_id)',
  'CREATE INDEX idx_sale_payments_sale_id ON sale_payments(sale_id, paid_at)',
  'CREATE INDEX idx_sales_returns_sale_id ON sales_returns(sale_id, created_at)',
  'CREATE INDEX idx_sales_return_items_return_id ON sales_return_items(return_id)',
  'CREATE INDEX idx_purchases_branch_date ON purchases(branch_id, created_at)',
  'CREATE INDEX idx_purchases_supplier_date ON purchases(supplier_id, created_at)',
  'CREATE INDEX idx_purchase_items_purchase_id ON purchase_items(purchase_id)',
  'CREATE INDEX idx_purchase_items_product_id ON purchase_items(product_id)',
  'CREATE INDEX idx_purchase_payments_purchase_id ON purchase_payments(purchase_id, paid_at)',
  'CREATE INDEX idx_purchase_returns_purchase_id ON purchase_returns(purchase_id, created_at)',
  'CREATE INDEX idx_purchase_return_items_return_id ON purchase_return_items(return_id)',
  'CREATE INDEX idx_inventory_product_warehouse_date ON inventory_movements(product_id, warehouse_id, occurred_at)',
  'CREATE INDEX idx_inventory_source ON inventory_movements(source_type, source_id)',
  'CREATE INDEX idx_balances_warehouse_product ON inventory_balances(warehouse_id, product_id)',
  'CREATE INDEX idx_transfers_status_date ON stock_transfers(status, created_at)',
  'CREATE INDEX idx_transfers_from_warehouse ON stock_transfers(from_warehouse_id, created_at)',
  'CREATE INDEX idx_transfers_to_warehouse ON stock_transfers(to_warehouse_id, created_at)',
  'CREATE INDEX idx_transfer_items_transfer_id ON stock_transfer_items(transfer_id)',
  'CREATE INDEX idx_stock_counts_warehouse_status ON stock_counts(warehouse_id, status)',
  'CREATE INDEX idx_stock_count_items_product ON stock_count_items(product_id)',
  'CREATE INDEX idx_expenses_branch_date ON expenses(branch_id, incurred_at)',
  'CREATE INDEX idx_cashboxes_branch ON cashboxes(branch_id)',
  'CREATE INDEX idx_cash_movements_cashbox_date ON cash_movements(cashbox_id, occurred_at)',
  'CREATE INDEX idx_cash_movements_source ON cash_movements(source_type, source_id)',
  'CREATE INDEX idx_manufacturing_branch_status ON manufacturing_orders(branch_id, status)',
  'CREATE INDEX idx_manufacturing_product ON manufacturing_orders(finished_product_id, created_at)',
  'CREATE INDEX idx_manufacturing_material_order ON manufacturing_materials(order_id)',
  'CREATE INDEX idx_manufacturing_material_product ON manufacturing_materials(product_id)',
  'CREATE INDEX idx_manufacturing_costs_order_date ON manufacturing_costs(order_id, incurred_at)',
  'CREATE INDEX idx_production_stages_order ON production_stages(order_id, sequence)',
  'CREATE INDEX idx_production_outputs_order ON production_outputs(order_id)',
  'CREATE INDEX idx_audit_entity_date ON audit_logs(entity_type, entity_id, occurred_at)',
  'CREATE INDEX idx_audit_actor_date ON audit_logs(actor_user_id, occurred_at)',
  `CREATE TRIGGER inventory_movements_no_update
    BEFORE UPDATE ON inventory_movements
    BEGIN
      SELECT RAISE(ABORT, 'inventory movements are immutable');
    END`,
  `CREATE TRIGGER inventory_movements_no_delete
    BEFORE DELETE ON inventory_movements
    BEGIN
      SELECT RAISE(ABORT, 'inventory movements are immutable');
    END`,
  `CREATE TRIGGER audit_logs_no_update
    BEFORE UPDATE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'audit logs are immutable');
    END`,
  `CREATE TRIGGER audit_logs_no_delete
    BEFORE DELETE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'audit logs are immutable');
    END`,
  `CREATE TRIGGER sale_payments_no_update
    BEFORE UPDATE ON sale_payments
    BEGIN
      SELECT RAISE(ABORT, 'sale payments are immutable');
    END`,
  `CREATE TRIGGER sale_payments_no_delete
    BEFORE DELETE ON sale_payments
    BEGIN
      SELECT RAISE(ABORT, 'sale payments are immutable');
    END`,
  `CREATE TRIGGER purchase_payments_no_update
    BEFORE UPDATE ON purchase_payments
    BEGIN
      SELECT RAISE(ABORT, 'purchase payments are immutable');
    END`,
  `CREATE TRIGGER purchase_payments_no_delete
    BEFORE DELETE ON purchase_payments
    BEGIN
      SELECT RAISE(ABORT, 'purchase payments are immutable');
    END`,
  `CREATE TRIGGER cash_movements_no_update
    BEFORE UPDATE ON cash_movements
    BEGIN
      SELECT RAISE(ABORT, 'cash movements are immutable');
    END`,
  `CREATE TRIGGER cash_movements_no_delete
    BEFORE DELETE ON cash_movements
    BEGIN
      SELECT RAISE(ABORT, 'cash movements are immutable');
    END`,
  `CREATE TRIGGER sales_no_delete_posted
    BEFORE DELETE ON sales
    WHEN OLD.status <> 'draft'
    BEGIN
      SELECT RAISE(ABORT, 'posted sales cannot be deleted');
    END`,
  `CREATE TRIGGER purchases_no_delete_received
    BEFORE DELETE ON purchases
    WHEN OLD.status <> 'draft'
    BEGIN
      SELECT RAISE(ABORT, 'received purchases cannot be deleted');
    END`,
] as const
