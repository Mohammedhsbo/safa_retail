import { defineRailway, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "api";
export default defineRailway(() => {
  const api = service("api", {
    build: { builder: "DOCKERFILE", dockerfilePath: ".railway/backend.Dockerfile" },
    start: "node apps/backend/dist/server.js",
    healthcheck: "/api/v1/health",
    healthcheckTimeout: 120,
    replicas: { "iad": 1 },
  });

  return project("prolific-smile", {
    resources: [api],
  });
});
