# SAFA Retail — Android and Web retail application

The Android and browser applications use the same online API and PostgreSQL database. The web app initializes against the configured backend and shows a connection/startup error when it cannot connect. SQLite remains in the codebase for legacy data retention and service tests; it is not the online production data source. No iOS application target is maintained.

## Application screens

The authenticated application includes online login and initial owner setup; dashboard; branch and warehouse selection; product list/details, categories, brands, and barcode management; POS, sales history/invoice details and returns; purchases/details; customer and supplier registers/statements; inventory, warehouse details, stock transfers, and stocktaking; expenses and cashboxes; financial reports; manufacturing orders/details; user and role/permission management; application settings; backup/restore; audit logs; and database health checks. Routes and actions are gated by existing permission and location checks. English and Arabic resources are provided.

Manufacturing order creation currently exposes one raw-material line per order; additional material consumption remains available through the service. User creation assigns the current branch and warehouse. Native device/emulator acceptance testing is still required after syncing/building the latest Android changes.

## Requirements

- Node.js 22.12 or newer (Vite 8 requirement).
- pnpm 10.

## Commands

Run these commands from the repository root:

```sh
pnpm install
pnpm --filter safa-retail-web dev
pnpm --filter safa-retail-web test
pnpm --filter safa-retail-web lint
pnpm --filter safa-retail-web build
```

The build runs the TypeScript project checks before producing the Vite production bundle. Tests use Vitest, jsdom, and React Testing Library.

## Foundation included

- React, strict TypeScript, Vite, and Tailwind CSS.
- React Router with a localized not-found route.
- Arabic-first RTL layout with an English language switch.
- i18next resources and document `lang`/`dir` synchronization.
- A transient Zustand UI preferences store with Zod locale validation.
- Reusable buttons and cards, shared design tokens, and responsive base styles.
- React error boundary, global runtime error reporting, and Sonner notifications.
- Focused tests for Arabic RTL rendering, language/direction switching, invalid locale rejection, error recovery, and unknown routes.

The locale preference is intentionally in-memory for now. Business records are not persisted in browser storage.

## Online environment

Copy `.env.example` to a local environment file and set `VITE_API_BASE_URL` to the HTTPS API URL. For production builds, use the same Railway URL in Vercel and the Android build environment. The backend URL is public; do not put credentials in any `VITE_*` variable. See the backend deployment guide at `../backend/README.md`.

## Authentication and authorization

Authentication and business requests are sent to the online backend. Refresh credentials use HttpOnly cookies and access tokens are held in memory. Server-side services repeat permission checks; UI route gating is not treated as an authorization boundary.

The suite covers the frontend foundation and the reusable business-service rules. Most business-service tests use a SQLite test driver; runtime requests are forwarded to the PostgreSQL-backed API. See [PROJECT_AUDIT.md](../../PROJECT_AUDIT.md) for the earlier feature/test history.

## Business configuration and organization

Services manage the three configurable business activities, an organization profile, branches, and warehouses. They enforce `settings.manage`, audit changes, archive branches and warehouses, and prevent moving warehouses once operational history, balances, or user assignments exist. Branch/warehouse selection and business-activity settings are routed screens.

At the end of Phase 4, the suite included 29 tests, including local database test coverage for organization/configuration.

## Product catalog

Phase 5 provides services and repositories for categories, brands, measurement units, products, prices, barcodes, product attributes, image references, and product-specific unit conversions. Runtime database access is through PostgreSQL. The ten named standard units can be seeded explicitly; custom units remain supported. Prices and quantities are validated and stored as decimal strings. Conversion factors must be explicitly configured for each product; no cross-dimension conversion is assumed. Product image rows hold relative file-path metadata only; remote media storage remains unconfigured.

At Phase 5 completion, the suite included 35 tests, including six local database catalog tests.

## Sales and POS

Phase 7 provides a localized POS component and sales services for product name/SKU/barcode search, configured units, discounts and authorized price edits, customer selection, split/partial payments, credit invoices, invoice history, cancellation, and partial/full returns. Runtime operations use PostgreSQL. Sales post invoice rows, payments, stock movements/balances, and audit records in one transaction. Refunds/cancellations append signed payment reversals; inventory returns use original sale cost. Invoice reads distinguish balance due from customer credit, but do not yet post customer account ledger entries. Branch tax settings default to 0% exclusive and can be configured as inclusive or exclusive; each invoice preserves the applied tax configuration.

`PosScreen` receives the authenticated actor, active branch/warehouse, and `SalesService` from app startup. Sales history, invoice details, and returns are permission-gated routes. Native barcode camera/printer integrations remain device-validation work.

## Purchases and suppliers

Phase 8 provides supplier management, purchase drafts, explicit goods receipt, weighted-average inventory posting, immutable supplier payments, purchase returns and supplier credits, purchase history, and branch-scoped supplier statements. Runtime operations use PostgreSQL. Drafts do not affect stock; receipt and return document, inventory, payment/balance, and audit writes are transactional. Migration 4 adds the optional supplier invoice reference. Supplier registers/statements and purchase list/details are routed workflows.

## Customers and financial management

Phase 9 provides customer management, branch-scoped customer statements and balances, collections applied to specific credit invoices, cashboxes, receipts/disbursements/transfers, and posted expenses. Runtime operations use PostgreSQL. Customer collections append immutable invoice payment records and cash receipts atomically. Cash movements and audit events are immutable; transfers post balanced entries to both cashboxes, and expenses/disbursements/transfers cannot overdraw the source box. Customer/supplier statements, expenses, and cashbox workflows are routed. Upfront POS tender and supplier-payment records are not yet automatically linked to a cashbox.

## Manufacturing

Phase 10 provides production orders, raw-material requirements and explicit incremental consumption, sequential stages, additional production costs, output/waste completion, and approved finished-goods posting. Runtime operations use PostgreSQL. Material usage posts stock-out movements at current weighted-average costs; output approval adds the consumed material and additional costs and posts finished stock at the resulting base-unit cost. Completion alone does not increase inventory. No schema migration was needed because manufacturing tables already exist in schema version 4. Manufacturing list and detail workflows are routed; production-cost cash payments and cancellation/reversal of started orders are not integrated.

## Reporting and exports

Phase 11 provides permission- and location-scoped reporting over schema v4 and a localized React dashboard component. Reports include dashboard KPIs, sales/purchase analytics, expense summaries, tax-exclusive profit and loss, current inventory valuation/low-stock, customer/supplier balances, branch performance, and manufacturing output/waste/costs. The component supports date and accessible-branch filters, report tables, and browser XLSX/PDF downloads. Inventory valuation is a current snapshot; account balances are calculated as of the selected end date.

## Backup and restore

Phase 12 provides full SQLite JSON backups in a versioned `.safa` file with a SHA-256 integrity checksum, a 256 MiB size cap, current-schema compatibility checks, import preview, and explicit restore confirmation. Restore snapshots the existing database and attempts rollback unless the imported database passes integrity, foreign-key, and schema checks. Backup access requires `settings.manage`.

PostgreSQL backups are unencrypted and contain sensitive business/user records; store them securely. The optional interval setting only indicates when a manual backup is due; it does not schedule background exports. The routed component downloads and restores server-generated snapshots through permission-checked API routes. Android file picker/share behavior still requires device validation.

## Reporting and exports

Phase 11 provides a permission- and location-scoped read-only reporting service over schema v4, plus a localized dashboard component. Runtime reporting uses PostgreSQL. It generates dashboard KPIs, daily sales and purchase analytics, expense and tax-exclusive profit-and-loss reports, current inventory valuation/low-stock, customer and supplier balances, branch performance, and manufacturing output/waste/cost reports. Monetary and quantity aggregation uses fixed-point decimal helpers. Date-range activity uses UTC calendar days; account balances are cumulative through the report end date. Inventory value is a current snapshot rather than historical valuation. The dashboard supports date/branch filters, tabular report views, and browser XLSX/PDF downloads.

## Inventory

Phase 6 provides services and repositories for stock adjustments, movement history, balances, weighted-average valuation, transfers, and stock counts. Runtime operations use PostgreSQL. Quantity, conversion, and cost calculations use nine-place fixed-point arithmetic. Negative stock is rejected; transfers are permission/scope checked and move stock at dispatch and receipt; stock counts reconcile against balances at approval. Inventory balances, warehouse details, stock transfers, and stocktaking are routed workflows. Migration 2 adds cost columns with zero defaults, so pre-migration inventory requires traceable cost reconciliation before its valuation can be relied on.

## Structure

```text
src/
  app/                 # App routes, locale synchronization, error boundary
  features/foundation/ # Phase 1 entry and not-found screens
  features/auth/       # Phase 3 authentication and authorization services
  features/organization/ # Phase 4 business configuration and organization services
  features/catalog/     # Phase 5 product catalog services and repository
  features/inventory/   # Phase 6 inventory services and repository
  features/sales/       # Phase 7 POS component, sales service, and repository
  features/purchases/   # Phase 8 purchase and supplier services/repository
  features/accounting/  # Phase 9 customer accounts and cash/expense services
  features/manufacturing/ # Phase 10 production orders, materials, stages, and output
  features/reports/       # Phase 11 scoped reporting and dashboard component
  features/backup/        # Phase 12 UI backed by PostgreSQL backup API routes
  shared/              # Components, localization, state, errors, validation
  styles/              # Tailwind import and design tokens
  test/                # Test setup
```
