# GTM AI

Clay-style GTM data platform: spreadsheet tables whose cells are BullMQ jobs
(enrichment waterfalls, LLM agents, formulas, HTTP), with audiences, signals,
workflows, sequences, ads sync, CRM write-back, team roles, and a CLI/MCP.

## Layout

- `apps/web` — Next.js 15 (App Router), port 3000
- `apps/api` — NestJS 10 + Fastify, port 4000, Swagger at `/docs`
- `apps/worker` — BullMQ consumers (cells, signals, workflows, outbound, ads, crm, usage)
- `packages/{db,providers,shared,cli,mcp}` — Prisma schema, provider SDK,
  pure-TS shared lib, public-API CLI, MCP server
- `tools/bazel`, `scripts` — Bazel wrapper scripts + affected-test runner
- `fly.*.toml`, `apps/*/Dockerfile` — fly.io deploy config

## Core flow (the thing to understand first)

```
web grid ──POST /tables/:id/run──▶ api enqueues BullMQ job on 'cells'
                                     │
worker 'cells' consumer ◀────────────┘  reads column.config, resolves
   │  {{Column}} bindings against row data, runs executor for column.kind
   │  (formula|input|enrichment|waterfall|agent|http|function)
   ├─ writes Cell { status: done|error|skipped, value, creditsUsed }
   └─ publishes JSON to redis channel `table:<tableId>`
                                     │
api GET /tables/:id/events (SSE) ◀─────┘  subscribes to that channel,
   └─ streams each message to the grid ──▶ web updates the cell live
```

Other queues (all consumed in `apps/worker/src/phase2-worker.ts`): `signals`
(poll external signal sources), `workflows` (run node-graph steps),
`outbound` (sequence/campaign send steps), `ads` (audience sync), `crm`
(write-back jobs), `usage` (usage snapshots).

## Data model map

`packages/db/prisma/schema.prisma`, ~60 models, `String @id @default(cuid())`
everywhere. Grouped by domain:

| Domain    | Models                                                                                 | Notes                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Org       | `Workspace`, `User`, `Membership`, `ApiKey`, `Invite` (in team)                        | roles: owner/admin/editor/viewer                                                                                                             |
| Grid      | `Folder`, `Workbook`, `Table`, `Column`, `Row`, `Cell`, `View`, `Tag`, `TagAssignment` | hierarchy Workspace→(Folder)→Workbook→Table→View; `Column.kind` picks the executor; `Column.config` is JSON validated by `shared/schemas.ts` |
| Providers | `Connection`                                                                           | AES-256-GCM encrypted credentials per workspace+provider                                                                                     |
| Audiences | `Company`, `Contact`, `FieldDefinition`, `DataSource`, `Segment`, `SegmentMembership`  | dedupe via unique keys; `Segment.filter` is the shared filter DSL                                                                            |
| Signals   | `SignalDefinition`, `SignalEvent`                                                      | HMAC-verified ingest + pollers; events fire workflow triggers                                                                                |
| Workflows | `Workflow`, `WorkflowRun`, `StepRun`                                                   | DAG of typed nodes (`shared/workflows.ts`) run step-by-step on BullMQ                                                                        |
| Functions | `Function`, `FunctionVersion`, `FunctionRun`                                           | versioned JS run in cells (`function` column kind)                                                                                           |
| Outbound  | `Inbox`, `Sequence`, `SequenceStep`, `Campaign`, `Enrollment`, `Message`, `Reply`      | Campaign enrolls contacts into a Sequence of delayed Steps via Inbox                                                                         |
| Ads       | `AdAudience`, `AdPlatformSync`                                                         | hashed audience upload (Meta adapter)                                                                                                        |
| CRM       | `CrmSyncJob`, `CrmSyncRecord`, `CrmSyncRun`                                            | hubspot/salesforce write-back                                                                                                                |
| Billing   | `CreditLedger`, `CreditBudget`, `UsageSnapshot`                                        | ledger rows per cell run; budgets checked before execution                                                                                   |
| Alerts    | `AlertChannel`, `Alert`                                                                | notification targets for signal/workflow events                                                                                              |
| Content   | `Template`                                                                             | built-in table templates from `shared/templates.ts`                                                                                          |

## Checks

```sh
bazel test //...          # lint, typecheck, unit tests, builds, api itest
pnpm exec prettier --check .
scripts/bazel-affected.sh # changed-files → affected targets only
```

The api integration test boots ephemeral Postgres+Redis via docker — no
services needed locally. See `docs/bazel-pilot.md`.

## Deploy

```sh
fly deploy -c fly.api.toml     # release_command runs prisma migrate deploy
fly deploy -c fly.worker.toml
fly deploy -c fly.web.toml
```

Env vars: `DATABASE_URL`, `REDIS_URL` (api+worker+seed), `JWT_SECRET`,
`ENCRYPTION_KEY` (64-hex, credential crypto), `NEXT_PUBLIC_API_URL` (web),
`CELL_CONCURRENCY`, `PROVIDER_RATE_LIMIT` (worker tuning).

## Conventions

- pnpm 9 workspace; **Bazel is the check entry point**, not the pnpm scripts.
- `@gtmai/*` packages resolve via `main`/`types` → `dist/` — deps must be built
  before consumers typecheck (the bazel wrappers handle this).
- Every ioredis/BullMQ connection sets `family: 0` — fly `.internal` DNS is
  IPv6-only (AAAA); the ioredis default `family: 4` fails with ENOTFOUND.
- No self-signup: users join via `/invite/[token]` links. Viewers are
  read-only outside `/auth/*`; API keys act as editor.
- `.env*` files hold secrets and are git+docker-ignored — never commit them.
- Demo login: `demo@gtmai.dev` / `demo1234` (seeded "Prospects" table).
