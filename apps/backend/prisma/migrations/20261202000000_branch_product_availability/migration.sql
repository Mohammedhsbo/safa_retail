ALTER TABLE "warehouses"
ADD COLUMN "warehouse_type" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "description" TEXT,
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "warehouses"
ADD CONSTRAINT "warehouses_warehouse_type_check"
CHECK ("warehouse_type" IS NULL OR "warehouse_type" IN (
  'clothing_manufacturing',
  'detergent_manufacturing',
  'fabrics'
));

CREATE TABLE "product_branch_availability" (
  "product_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "purchase_price" TEXT NOT NULL,
  "selling_price" TEXT NOT NULL,
  "minimum_stock" TEXT NOT NULL DEFAULT '0',
  "status" TEXT NOT NULL CHECK ("status" IN ('active', 'inactive')),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "product_branch_availability_pkey" PRIMARY KEY ("product_id", "branch_id"),
  CONSTRAINT "product_branch_availability_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "product_branch_availability_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

INSERT INTO "product_branch_availability"
  ("product_id", "branch_id", "purchase_price", "selling_price", "minimum_stock",
   "status", "created_at", "updated_at")
SELECT p."id", b."id", p."purchase_price", p."selling_price", p."minimum_stock",
       CASE WHEN p."status" = 'active' THEN 'active' ELSE 'inactive' END,
       p."created_at", p."updated_at"
FROM "products" p
CROSS JOIN "branches" b
WHERE p."status" <> 'archived' AND b."status" = 'active';

CREATE INDEX "idx_product_branch_availability_branch"
ON "product_branch_availability"("branch_id", "status", "product_id");
