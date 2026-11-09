# SAFA Retail Backend

Standalone Express API for the shared Android and browser application. PostgreSQL is the source of truth; the backend never falls back to local business storage.

## Local development

1. Copy `.env.example` to `.env` and set a local PostgreSQL `DATABASE_URL` plus two different, randomly generated JWT secrets.
2. Install the root workspace dependencies with `pnpm install`.
3. Generate the Prisma client and apply migrations: `pnpm db:generate` and `pnpm db:migrate:dev`.
4. Start the API with `pnpm dev`; readiness is exposed at `/api/v1/health`.

The API includes health checks, first-owner setup, sign-in, cookie-backed refresh-token rotation, logout, authenticated principal lookup, permission-scoped business operations, administration, audit logs, database health, and PostgreSQL backup/restore. Authentication reuses the existing PBKDF2-SHA256 password-hash format. PostgreSQL must be reachable before API operations can run.

## Production environment

### Railway

The root `railway.json` builds the backend, applies Prisma migrations before startup, and uses `/api/v1/health` as its health check. Deploy from the repository root and provision Railway PostgreSQL. Set:

- `NODE_ENV=production`
- `DATABASE_URL` to Railway PostgreSQL's `DATABASE_URL` reference
- `JWT_SECRET` and `JWT_REFRESH_SECRET` to separate random secrets of at least 32 characters
- `CORS_ORIGINS` to a comma-separated allowlist of exact HTTPS origins: the production Vercel domain, every Vercel Preview hostname that should be allowed, and `https://localhost` for the Android Capacitor WebView

Railway supplies `PORT`. Do not use wildcard origins; update the allowlist when preview domains change.

### Vercel

The root `vercel.json` builds `apps/web` and routes browser paths to the SPA entry point so direct navigation and refresh work. Set `VITE_API_BASE_URL` to the Railway HTTPS API base URL (for example `https://<your-service>.up.railway.app`) for Production and Preview environments. This value is public and contains no credentials.

### Android

Set `VITE_API_BASE_URL` to the same Railway HTTPS URL when building the Android web bundle, then run `pnpm --filter safa-retail-web android:build`. Do not ship a localhost API URL. The Android WebView origin must be allowed in Railway `CORS_ORIGINS`.

Refresh tokens are HttpOnly, Secure cookies in production; access tokens remain in client memory. Service-role credentials and secrets must never be added to client bundles. If browser third-party cookie restrictions block cross-origin refresh cookies, deploy the API under the same site or authorize a same-origin proxy before production rollout.

The existing domain modules were wired to the PostgreSQL SQL adapter and the existing SQLite schema was used to generate the Prisma migration. This does not migrate any device-local data. Do not remove SQLite data or dependencies until a data export/import has been verified against Railway PostgreSQL with matching record counts and integrity checks.

PostgreSQL backup exports are authenticated and permission-checked, checksummed, capped at 256 MiB, and restored transactionally only when table names/columns match the current schema. A failed restore rolls back. The displayed backup schedule is advisory; it does not run unattended backups. Configure actual scheduled backups through Railway or another authorized PostgreSQL backup facility.

## Verification limitations

Builds and local tests do not establish Railway connectivity, Vercel deployment, Android device behavior, live CRUD parity, or a successful production backup/restore. Those require a provisioned PostgreSQL database, deployed service URLs, authorized environment configuration, and an Android test device/emulator.
