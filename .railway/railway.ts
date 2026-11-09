import { defineRailway, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "api";
export default defineRailway(() => {
  const api = service("api", {
    build: { buildCommand: "pnpm install --frozen-lockfile && pnpm --filter @safa/backend build", buildEnvironment: "V3", builder: "NIXPACKS" },
    start: "pnpm --filter @safa/backend db:migrate:deploy && pnpm --filter @safa/backend start",
    healthcheck: "/api/v1/health",
    healthcheckTimeout: 120,
    replicas: { "iad": 1 },
  });

  return project("prolific-smile", {
    variables: { managed: false },
    resources: [api],
  });
});
