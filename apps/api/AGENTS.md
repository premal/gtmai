# apps/api

NestJS + Fastify. One module per domain under `src/` (tables, audiences,
signals, workflows, sequences, ads, crm, workbooks, folders, tags, team,
search, usage, api-keys, functions, templates, …). Swagger UI at `/docs`.

## Conventions

- **Cell execution is async**: run endpoints enqueue BullMQ jobs; the worker
  writes cells and publishes `table:<id>` on Redis; `events.controller.ts`
  streams them to the grid over SSE.
- `JwtAuthGuard` re-reads the membership on every request — role changes and
  removals apply immediately, no token refresh needed. `@Roles(...)` marks
  admin-only routes; any non-GET from a viewer outside `/auth/*` → 403.
- API keys (`Authorization: Bearer gtm_…`) act as `editor`.
- Provider credentials are AES-256-GCM encrypted with `ENCRYPTION_KEY`
  (64-hex env) before storage.
- BullMQ connection needs `family: 0` for fly's IPv6-only `.internal` DNS.

## Tests

`main.test.ts` + friends are real integration tests needing Postgres+Redis —
run them via `bazel test //apps/api:itest` (ephemeral containers, migrations
applied per run) rather than `pnpm test`. `src/test-helpers.ts` has shared
register/login/table factories.
