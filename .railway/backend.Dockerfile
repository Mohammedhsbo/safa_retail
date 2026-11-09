FROM node:22-bookworm-slim AS build

WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/types/package.json packages/types/package.json

RUN pnpm install --filter @safa/backend... --frozen-lockfile --store-dir=/tmp/pnpm-store \
  && rm -rf /tmp/pnpm-store

COPY apps/backend apps/backend
COPY apps/web/src apps/web/src
COPY packages packages

RUN ln -s ../backend/node_modules apps/web/node_modules \
  && DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build pnpm --filter @safa/backend build \
  && generated_client="$(find /workspace/node_modules/.pnpm -path '*/node_modules/.prisma/client/index.js' -print -quit)" \
  && test -n "$generated_client" \
  && mkdir -p /tmp/prisma-client \
  && cp -R "$(dirname "$generated_client")" /tmp/prisma-client/client

FROM node:22-bookworm-slim AS runtime

WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/types/package.json packages/types/package.json

RUN pnpm install --filter @safa/backend... --prod --frozen-lockfile --store-dir=/tmp/pnpm-store \
  && rm -rf /tmp/pnpm-store

COPY --from=build /workspace/apps/backend/dist apps/backend/dist
COPY --from=build /workspace/apps/backend/prisma apps/backend/prisma
COPY --from=build /tmp/prisma-client/client /tmp/prisma-client

RUN client_package="$(find /workspace/node_modules/.pnpm -path '*/node_modules/@prisma/client/default.js' -print -quit)" \
  && test -n "$client_package" \
  && modules_dir="$(dirname "$(dirname "$(dirname "$client_package")")")" \
  && mkdir -p "$modules_dir/.prisma" \
  && cp -R /tmp/prisma-client "$modules_dir/.prisma/client" \
  && rm -rf /tmp/prisma-client

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "apps/backend/dist/server.js"]
