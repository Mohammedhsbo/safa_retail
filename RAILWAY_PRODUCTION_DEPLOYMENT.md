# Railway Production Deployment

## Production services

- Railway project: `prolific-smile`
- Environment: `production`
- API service: `api`
- PostgreSQL service: `Postgres`
- API URL: <https://api-production-d678.up.railway.app>
- Health check: `GET /api/v1/health`

The API service uses the repository root as its source root. The backend package
is under `apps/backend`, but the root contains the pnpm workspace and lockfile
required by the build and start commands.

The Railway configuration is maintained in `.railway/railway.ts`. It builds
with `pnpm install --frozen-lockfile && pnpm --filter @safa/backend build` and
starts with `pnpm --filter @safa/backend db:migrate:deploy && pnpm --filter
@safa/backend start`.

## Production variables

Set variables in Railway, not in committed environment files:

- `NODE_ENV=production`
- `PORT=3000`
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `JWT_SECRET` — independently generated, at least 32 characters
- `JWT_REFRESH_SECRET` — independently generated and different from `JWT_SECRET`
- `CORS_ORIGINS` — comma-separated exact HTTPS origins

The Android Capacitor WebView origin is `https://localhost`. Add each deployed
Vercel origin as an exact HTTPS origin to `CORS_ORIGINS` in Railway. The Vercel
project uses `VITE_API_BASE_URL` with the API URL above. The web template is in
`apps/web/.env.example`.

## Database restore and migrations

Before restoring data, the new Railway database was verified to have no public
tables. The verified local backup was restored without resetting or replacing
any existing production database. No `prisma migrate reset` or `prisma db push`
was used.

Backup on the deployment workstation:

`C:\Users\RTX\AppData\Local\SAFA\backups\safa-local-pre-railway-20261108.dump`

SHA-256:

`0140E38C9D0095121EEB2DBEA9D3BD04508D3633918CAFB7C8D90F7842FBD4D8`

Railway ran `prisma migrate deploy` at startup. It found two migrations and no
pending migrations. The restored record counts were 2 users, 2 branches, 3
warehouses, and 1 product; there were no customers, suppliers, sales, or
purchases in the backup.

## Android build

The production-configured debug APK is built with:

```powershell
$env:VITE_API_BASE_URL = 'https://api-production-d678.up.railway.app'
pnpm --filter safa-retail-web android:build
```

Output:

`apps/web/android/app/build/outputs/apk/debug/app-debug.apk`

This is a debug APK, not a release-signed distribution build. A release signing
key must be configured before publishing a release APK.

## Updating the API

From the repository root, preview/apply service configuration with:

```powershell
railway config plan --environment production
railway config apply --environment production --yes
railway up --service api --environment production --project <project-id>
```

Keep the API source root at the repository root so pnpm workspace commands and
the lockfile remain available. Never put production secrets in source files or
deployment logs.
