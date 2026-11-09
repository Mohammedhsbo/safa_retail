ALTER TABLE "sales"
ADD COLUMN "additional_rate" TEXT NOT NULL DEFAULT '0',
ADD COLUMN "additional_total" TEXT NOT NULL DEFAULT '0';
