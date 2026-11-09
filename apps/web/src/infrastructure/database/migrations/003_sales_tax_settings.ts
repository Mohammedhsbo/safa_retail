export const salesTaxSettingsStatements = [
  `CREATE TABLE sales_tax_settings (
    branch_id TEXT PRIMARY KEY NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    tax_rate TEXT NOT NULL DEFAULT '0',
    tax_mode TEXT NOT NULL DEFAULT 'exclusive'
      CHECK (tax_mode IN ('exclusive', 'inclusive')),
    updated_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    updated_at TEXT NOT NULL
  )`,
  "ALTER TABLE sales ADD COLUMN tax_rate TEXT NOT NULL DEFAULT '0'",
  `ALTER TABLE sales ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'exclusive'
    CHECK (tax_mode IN ('exclusive', 'inclusive'))`,
] as const
