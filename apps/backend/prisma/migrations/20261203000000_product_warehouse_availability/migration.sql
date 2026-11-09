CREATE TABLE "product_warehouse_availability" (
  "product_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "purchase_price" TEXT NOT NULL,
  "selling_price" TEXT NOT NULL,
  "minimum_stock" TEXT NOT NULL DEFAULT '0',
  "status" TEXT NOT NULL CHECK ("status" IN ('active', 'inactive')),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "product_warehouse_availability_pkey"
    PRIMARY KEY ("product_id", "warehouse_id"),
  CONSTRAINT "product_warehouse_availability_product_branch_fkey"
    FOREIGN KEY ("product_id", "branch_id")
    REFERENCES "product_branch_availability"("product_id", "branch_id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "product_warehouse_availability_warehouse_branch_fkey"
    FOREIGN KEY ("warehouse_id", "branch_id")
    REFERENCES "warehouses"("id", "branch_id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);

INSERT INTO "product_warehouse_availability"
  ("product_id", "branch_id", "warehouse_id", "purchase_price", "selling_price",
   "minimum_stock", "status", "created_at", "updated_at")
SELECT DISTINCT bpa."product_id", bpa."branch_id", w."id", bpa."purchase_price",
       bpa."selling_price", bpa."minimum_stock", bpa."status",
       bpa."created_at", bpa."updated_at"
FROM "product_branch_availability" bpa
JOIN "warehouses" w ON w."branch_id" = bpa."branch_id"
WHERE EXISTS (
  SELECT 1 FROM "inventory_balances" ib
  WHERE ib."product_id" = bpa."product_id" AND ib."warehouse_id" = w."id"
) OR EXISTS (
  SELECT 1 FROM "inventory_movements" im
  WHERE im."product_id" = bpa."product_id" AND im."warehouse_id" = w."id"
);

CREATE INDEX "idx_product_warehouse_availability_warehouse"
ON "product_warehouse_availability"("warehouse_id", "status", "product_id");
