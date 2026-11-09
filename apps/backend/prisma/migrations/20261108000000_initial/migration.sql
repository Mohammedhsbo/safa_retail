-- CreateTable
CREATE TABLE "application_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "application_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_data" TEXT,
    "after_data" TEXT,
    "occurred_at" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_activities" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "business_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" TEXT NOT NULL,
    "cashbox_id" TEXT NOT NULL,
    "movement_type" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "occurred_at" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashboxes" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "cashboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_migrations" (
    "version" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "applied_at" TEXT NOT NULL,

    CONSTRAINT "database_migrations_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "incurred_at" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "on_hand_quantity" TEXT NOT NULL DEFAULT '0',
    "reserved_quantity" TEXT NOT NULL DEFAULT '0',
    "updated_at" TEXT NOT NULL,
    "average_unit_cost" TEXT NOT NULL DEFAULT '0',

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("product_id","warehouse_id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "movement_type" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "occurred_at" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TEXT NOT NULL,
    "unit_cost" TEXT NOT NULL DEFAULT '0',

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_costs" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "cost_type" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "incurred_at" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "manufacturing_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_materials" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "planned_quantity" TEXT NOT NULL,
    "consumed_quantity" TEXT,
    "unit_cost" TEXT,
    "consumed_at" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "manufacturing_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "finished_product_id" TEXT NOT NULL,
    "planned_quantity" TEXT NOT NULL,
    "actual_quantity" TEXT,
    "waste_quantity" TEXT,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "created_by" TEXT,
    "approved_by" TEXT,
    "started_at" TEXT,
    "completed_at" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "manufacturing_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_units" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "decimal_places" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "measurement_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "product_attributes" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "product_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_barcodes" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "unit_id" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "product_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_unit_conversions" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "factor_to_base" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "product_unit_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_outputs" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "production_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_stages" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TEXT,
    "completed_at" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "production_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" TEXT,
    "brand_id" TEXT,
    "description" TEXT,
    "base_unit_id" TEXT NOT NULL,
    "purchase_price" TEXT NOT NULL,
    "selling_price" TEXT NOT NULL,
    "minimum_stock" TEXT NOT NULL DEFAULT '0',
    "attributes" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "unit_cost" TEXT NOT NULL,
    "discount_total" TEXT NOT NULL DEFAULT '0',
    "tax_total" TEXT NOT NULL DEFAULT '0',
    "line_total" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_payments" (
    "id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "reference" TEXT,
    "paid_by" TEXT,
    "paid_at" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "purchase_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_items" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "purchase_item_id" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "refund_amount" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "return_number" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "refund_total" TEXT NOT NULL DEFAULT '0',
    "created_by" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "subtotal" TEXT NOT NULL,
    "discount_total" TEXT NOT NULL DEFAULT '0',
    "tax_total" TEXT NOT NULL DEFAULT '0',
    "total" TEXT NOT NULL,
    "notes" TEXT,
    "created_by" TEXT,
    "received_at" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    "supplier_invoice_number" TEXT,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_code" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_code")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_system" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "unit_price" TEXT NOT NULL,
    "discount_total" TEXT NOT NULL DEFAULT '0',
    "tax_total" TEXT NOT NULL DEFAULT '0',
    "line_total" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_payments" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "reference" TEXT,
    "received_by" TEXT,
    "paid_at" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "invoice_number" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "subtotal" TEXT NOT NULL,
    "discount_total" TEXT NOT NULL DEFAULT '0',
    "tax_total" TEXT NOT NULL DEFAULT '0',
    "total" TEXT NOT NULL,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    "tax_rate" TEXT NOT NULL DEFAULT '0',
    "tax_mode" TEXT NOT NULL DEFAULT 'exclusive',

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return_items" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "sale_item_id" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "refund_amount" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "sales_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_returns" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "return_number" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "refund_total" TEXT NOT NULL DEFAULT '0',
    "created_by" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_tax_settings" (
    "branch_id" TEXT NOT NULL,
    "tax_rate" TEXT NOT NULL DEFAULT '0',
    "tax_mode" TEXT NOT NULL DEFAULT 'exclusive',
    "updated_by" TEXT,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "sales_tax_settings_pkey" PRIMARY KEY ("branch_id")
);

-- CreateTable
CREATE TABLE "stock_count_items" (
    "id" TEXT NOT NULL,
    "stock_count_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "expected_quantity" TEXT NOT NULL,
    "counted_quantity" TEXT,
    "unit_id" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "count_number" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "counted_by" TEXT,
    "approved_by" TEXT,
    "started_at" TEXT,
    "completed_at" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_items" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "received_quantity" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" TEXT NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "from_branch_id" TEXT NOT NULL,
    "from_warehouse_id" TEXT NOT NULL,
    "to_branch_id" TEXT NOT NULL,
    "to_warehouse_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "requested_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "received_by" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_access" (
    "user_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,

    CONSTRAINT "user_branch_access_pkey" PRIMARY KEY ("user_id","branch_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "user_warehouse_access" (
    "user_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,

    CONSTRAINT "user_warehouse_access_pkey" PRIMARY KEY ("user_id","warehouse_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_audit_actor_date" ON "audit_logs"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_audit_entity_date" ON "audit_logs"("entity_type", "entity_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_branches_2" ON "branches"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_brands_2" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_business_activities_2" ON "business_activities"("code");

-- CreateIndex
CREATE INDEX "idx_business_activities_enabled" ON "business_activities"("enabled");

-- CreateIndex
CREATE INDEX "idx_cash_movements_source" ON "cash_movements"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "idx_cash_movements_cashbox_date" ON "cash_movements"("cashbox_id", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_cashboxes_branch" ON "cashboxes"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_cashboxes_3" ON "cashboxes"("id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_cashboxes_2" ON "cashboxes"("branch_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_categories_2" ON "categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_customers_2" ON "customers"("code");

-- CreateIndex
CREATE INDEX "idx_customers_name" ON "customers"("name");

-- CreateIndex
CREATE INDEX "idx_expenses_branch_date" ON "expenses"("branch_id", "incurred_at");

-- CreateIndex
CREATE INDEX "idx_balances_warehouse_product" ON "inventory_balances"("warehouse_id", "product_id");

-- CreateIndex
CREATE INDEX "idx_inventory_source" ON "inventory_movements"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "idx_inventory_product_warehouse_date" ON "inventory_movements"("product_id", "warehouse_id", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_manufacturing_costs_order_date" ON "manufacturing_costs"("order_id", "incurred_at");

-- CreateIndex
CREATE INDEX "idx_manufacturing_material_product" ON "manufacturing_materials"("product_id");

-- CreateIndex
CREATE INDEX "idx_manufacturing_material_order" ON "manufacturing_materials"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_manufacturing_orders_2" ON "manufacturing_orders"("order_number");

-- CreateIndex
CREATE INDEX "idx_manufacturing_product" ON "manufacturing_orders"("finished_product_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_manufacturing_branch_status" ON "manufacturing_orders"("branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_measurement_units_2" ON "measurement_units"("code");

-- CreateIndex
CREATE INDEX "idx_product_attributes_product_id" ON "product_attributes"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_product_attributes_2" ON "product_attributes"("product_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_product_barcodes_2" ON "product_barcodes"("barcode");

-- CreateIndex
CREATE INDEX "idx_product_barcodes_product_id" ON "product_barcodes"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_product_barcodes_3" ON "product_barcodes"("id", "product_id");

-- CreateIndex
CREATE INDEX "idx_product_images_product_order" ON "product_images"("product_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_product_images_2" ON "product_images"("product_id", "file_path");

-- CreateIndex
CREATE INDEX "idx_conversions_unit_id" ON "product_unit_conversions"("unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_product_unit_conversions_2" ON "product_unit_conversions"("product_id", "unit_id");

-- CreateIndex
CREATE INDEX "idx_production_outputs_order" ON "production_outputs"("order_id");

-- CreateIndex
CREATE INDEX "idx_production_stages_order" ON "production_stages"("order_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_production_stages_2" ON "production_stages"("order_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_products_2" ON "products"("sku");

-- CreateIndex
CREATE INDEX "idx_products_status_name" ON "products"("status", "name");

-- CreateIndex
CREATE INDEX "idx_products_brand_id" ON "products"("brand_id");

-- CreateIndex
CREATE INDEX "idx_products_category_id" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "idx_purchase_items_product_id" ON "purchase_items"("product_id");

-- CreateIndex
CREATE INDEX "idx_purchase_items_purchase_id" ON "purchase_items"("purchase_id");

-- CreateIndex
CREATE INDEX "idx_purchase_payments_purchase_id" ON "purchase_payments"("purchase_id", "paid_at");

-- CreateIndex
CREATE INDEX "idx_purchase_return_items_return_id" ON "purchase_return_items"("return_id");

-- CreateIndex
CREATE INDEX "idx_purchase_returns_purchase_id" ON "purchase_returns"("purchase_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_purchase_returns_2" ON "purchase_returns"("purchase_id", "return_number");

-- CreateIndex
CREATE INDEX "idx_purchases_supplier_date" ON "purchases"("supplier_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_purchases_branch_date" ON "purchases"("branch_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_purchases_2" ON "purchases"("branch_id", "invoice_number");

-- CreateIndex
CREATE INDEX "idx_role_permissions_permission" ON "role_permissions"("permission_code");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_roles_2" ON "roles"("code");

-- CreateIndex
CREATE INDEX "idx_sale_items_product_id" ON "sale_items"("product_id");

-- CreateIndex
CREATE INDEX "idx_sale_items_sale_id" ON "sale_items"("sale_id");

-- CreateIndex
CREATE INDEX "idx_sale_payments_sale_id" ON "sale_payments"("sale_id", "paid_at");

-- CreateIndex
CREATE INDEX "idx_sales_customer_date" ON "sales"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_sales_branch_date" ON "sales"("branch_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_sales_2" ON "sales"("branch_id", "invoice_number");

-- CreateIndex
CREATE INDEX "idx_sales_return_items_return_id" ON "sales_return_items"("return_id");

-- CreateIndex
CREATE INDEX "idx_sales_returns_sale_id" ON "sales_returns"("sale_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_sales_returns_2" ON "sales_returns"("sale_id", "return_number");

-- CreateIndex
CREATE INDEX "idx_stock_count_items_product" ON "stock_count_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_stock_count_items_2" ON "stock_count_items"("stock_count_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_stock_counts_2" ON "stock_counts"("count_number");

-- CreateIndex
CREATE INDEX "idx_stock_counts_warehouse_status" ON "stock_counts"("warehouse_id", "status");

-- CreateIndex
CREATE INDEX "idx_transfer_items_transfer_id" ON "stock_transfer_items"("transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_stock_transfers_2" ON "stock_transfers"("transfer_number");

-- CreateIndex
CREATE INDEX "idx_transfers_to_warehouse" ON "stock_transfers"("to_warehouse_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_transfers_from_warehouse" ON "stock_transfers"("from_warehouse_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_transfers_status_date" ON "stock_transfers"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_suppliers_2" ON "suppliers"("code");

-- CreateIndex
CREATE INDEX "idx_suppliers_name" ON "suppliers"("name");

-- CreateIndex
CREATE INDEX "idx_user_roles_role_id" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_users_2" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_expires_at_idx" ON "auth_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "idx_warehouses_branch_id" ON "warehouses"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_warehouses_3" ON "warehouses"("id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "sqlite_autoindex_warehouses_2" ON "warehouses"("branch_id", "code");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cashbox_id_fkey" FOREIGN KEY ("cashbox_id") REFERENCES "cashboxes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cashboxes" ADD CONSTRAINT "cashboxes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "manufacturing_costs" ADD CONSTRAINT "manufacturing_costs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "manufacturing_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "manufacturing_materials" ADD CONSTRAINT "manufacturing_materials_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "manufacturing_materials" ADD CONSTRAINT "manufacturing_materials_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "manufacturing_materials" ADD CONSTRAINT "manufacturing_materials_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "manufacturing_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_warehouse_id_branch_id_fkey" FOREIGN KEY ("warehouse_id", "branch_id") REFERENCES "warehouses"("id", "branch_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_finished_product_id_fkey" FOREIGN KEY ("finished_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_unit_conversions" ADD CONSTRAINT "product_unit_conversions_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_unit_conversions" ADD CONSTRAINT "product_unit_conversions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "manufacturing_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "manufacturing_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_base_unit_id_fkey" FOREIGN KEY ("base_unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchase_item_id_fkey" FOREIGN KEY ("purchase_item_id") REFERENCES "purchase_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "purchase_returns"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_warehouse_id_branch_id_fkey" FOREIGN KEY ("warehouse_id", "branch_id") REFERENCES "warehouses"("id", "branch_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_warehouse_id_branch_id_fkey" FOREIGN KEY ("warehouse_id", "branch_id") REFERENCES "warehouses"("id", "branch_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sales_returns"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_tax_settings" ADD CONSTRAINT "sales_tax_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_tax_settings" ADD CONSTRAINT "sales_tax_settings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_stock_count_id_fkey" FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_counted_by_fkey" FOREIGN KEY ("counted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_to_branch_id_fkey" FOREIGN KEY ("to_warehouse_id", "to_branch_id") REFERENCES "warehouses"("id", "branch_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_from_branch_id_fkey" FOREIGN KEY ("from_warehouse_id", "from_branch_id") REFERENCES "warehouses"("id", "branch_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_warehouse_access" ADD CONSTRAINT "user_warehouse_access_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_warehouse_access" ADD CONSTRAINT "user_warehouse_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
