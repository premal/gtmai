# apps/api

NestJS + Fastify. One module per domain under `src/`; `app.module.ts` wires
them all + `PrismaModule` + `EventsModule`. Swagger UI at `/docs`.

## Module → route map

| Module (dir)                | Route prefix                           | Owns                                                                                                                                      |
| --------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`                      | `/auth`                                | login, invite accept, me — JWT issue/verify                                                                                               |
| `workspaces`                | `/workspaces`                          | workspace CRUD, switch current                                                                                                            |
| `team`                      | `/team`                                | members, roles, invite links                                                                                                              |
| `api-keys`                  | `/api-keys`                            | `gtm_…` key create/list/revoke                                                                                                            |
| `folders`                   | `/folders`                             | folder CRUD (Workbook grouping)                                                                                                           |
| `workbooks`                 | `/workbooks`                           | workbook CRUD + per-user `WorkbookAccess`                                                                                                 |
| `tables`                    | `/tables`                              | table/column/row/cell CRUD, `/run` enqueue, CSV import/export, `/:id/metaprompt` + `/:id/run-condition` (LLM column drafts & formula gen) |
| `tables` (views.controller) | `/tables/:tableId/views`               | saved grid views (filter/sort/col-order)                                                                                                  |
| `tags`                      | `/tags`                                | workspace tags + assignments on tables                                                                                                    |
| `search`                    | `/search`                              | cross-workbook table/row search                                                                                                           |
| `integrations`              | `/integrations` (`/connections` alias) | provider credential CRUD (encrypted)                                                                                                      |
| `providers`                 | `/providers`                           | list available providers/actions                                                                                                          |
| `formula`                   | `/formula`                             | dry-run formula evaluation endpoint                                                                                                       |
| `audiences`                 | `/audiences`                           | Company/Contact upsert+dedupe, Segments                                                                                                   |
| `signals`                   | `/signals`                             | signal defs (table-scoped sources, schedules, alert channels), HMAC ingest `/signals/events`, pollers                                     |
| `workflows`                 | `/workflows`, `/workflows/hooks`       | workflow CRUD/run; webhook trigger endpoint                                                                                               |
| `functions`                 | `/functions`                           | versioned JS functions + run history                                                                                                      |
| `sequences`                 | `/sequences`, `/inboxes`, `/campaigns` | sequence + step CRUD; `/sequences/generate` drafts steps via LLM; sending inboxes; campaign CRUD + enrollment                             |
| `ads`                       | `/ads`                                 | ad audiences + platform syncs                                                                                                             |
| `crm`                       | `/crm`                                 | CRM sync jobs/runs                                                                                                                        |
| `usage`                     | `/usage`                               | budgets, summary, alerts, rollups, alert channels                                                                                         |
| `credits`                   | `/credits`                             | credit ledger                                                                                                                             |
| `templates`                 | `/templates`                           | built-in table templates                                                                                                                  |
| `events`                    | `/tables/:id/events`                   | SSE stream of cell updates (JwtAuthGuard'ed)                                                                                              |

## Conventions

- **Cell execution is async**: `POST /tables/:id/run` enqueues BullMQ jobs;
  the worker writes cells and publishes `table:<id>` on Redis; the SSE
  endpoint streams them to the grid. Never run executors in-process here.
- `JwtAuthGuard` re-reads the membership on every request — role changes and
  removals apply immediately. `@Roles(...)` marks admin-only routes; any
  non-GET from a viewer outside `/auth/*` → 403. `WorkbookResourceGuard` /
  `workbook-access.ts` enforce per-workbook `restricted` access.
- API keys (`Authorization: Bearer gtm_…`) authenticate as `editor`.
- Provider credentials are AES-256-GCM encrypted with `ENCRYPTION_KEY`
  (64-hex env) before storage; decrypted only inside the worker.
- Column `config` JSON is validated by the zod schemas in
  `packages/shared/src/schemas.ts` — keep api validation and worker
  execution on the same shapes.
- BullMQ connection needs `family: 0` for fly's IPv6-only `.internal` DNS.

## Tests

`*.test.ts` next to sources are real integration tests needing Postgres+Redis —
run them via `bazel test //apps/api:itest` (ephemeral containers, migrations
applied per run) rather than `pnpm test`. `src/test-helpers.ts` has shared
register/login/table factories.
