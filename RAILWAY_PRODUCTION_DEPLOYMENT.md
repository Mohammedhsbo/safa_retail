# Railway Production Deployment

## Production services

- Railway project: `prolific-smile`
- Environment: `production`
- API service: `api`
- PostgreSQL service: `Postgres`
- API URL: <https://api-production-d678.up.railway.app>
- Health check: `GET /api/v1/health`

The API service uses the repository root as its Docker build context. The
backend package is under `apps/backend`; the root pnpm workspace and lockfile
are required by the build.

The Railway configuration is maintained in `.railway/railway.ts` and uses
`.railway/backend.Dockerfile`. The Docker build pins Node 22 and pnpm 10.12.1,
installs only `@safa/backend` and its workspace dependencies using the root
lockfile, and compiles the backend. The backend also imports domain source from
`apps/web/src`, so that source is copied into the build without installing the
web app's frontend dependencies. A separate runtime image contains only
production dependencies, the compiled API, and Prisma's generated client,
schema, and migrations. Railway starts the compiled API with
`node apps/backend/dist/server.js`. Database migrations are not run during
image build or automatically at service startup.

The local development container continues to use `docker/dev.Dockerfile` via
`docker-compose.yml`; the Railway Dockerfile does not change that workflow.

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

From the repository root, commit/push the Railway configuration, Dockerfile,
workspace manifests, lockfile, backend, and required `apps/web/src` source. The
Railway service should use the root as its source directory and
`.railway/backend.Dockerfile` as its Dockerfile. Preview the infrastructure
change first:

```powershell
railway config plan --environment production
```

Apply only after confirming the plan changes the `api` service's builder,
Dockerfile path, and start command, and does not change PostgreSQL or
environment variables:

```powershell
railway config apply --environment production --yes
```

Then deploy the API source:

```powershell
railway up --service api --environment production --project prolific-smile
```

Before deploying, confirm the `api` service is the target and review Railway's
build and runtime logs. Apply any required Prisma migration as a separate,
explicit maintenance action after a backup and migration review; never add a
migration command to the image build or service start. Check
`GET /api/v1/health` after deployment. Never put production secrets in source
files or deployment logs.
