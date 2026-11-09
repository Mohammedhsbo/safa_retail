export const weightedAverageInventoryStatements = [
  "ALTER TABLE inventory_movements ADD COLUMN unit_cost TEXT NOT NULL DEFAULT '0'",
  "ALTER TABLE inventory_balances ADD COLUMN average_unit_cost TEXT NOT NULL DEFAULT '0'",
] as const
