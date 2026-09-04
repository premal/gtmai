# GTM AI — Architecture

An open GTM data platform (Clay-style): spreadsheet tables where every column is a data source,
enrichment provider, AI research agent, formula, or action; waterfall enrichment across many
providers; a GTM data layer (Audiences), signals, visual workflows, reusable functions, a cold-email
sequencer, ad-audience sync, CRM write-back, a public API/CLI and an MCP server.

## Stack

- **Monorepo**: pnpm workspaces + Turborepo, TypeScript everywhere (Node 20).
- **apps/web**: Next.js 15 (App Router), Tailwind, shadcn/ui-style components, TanStack Query + TanStack Table (virtualized grid).
- **apps/api**: NestJS 10 on the Fastify adapter. REST + OpenAPI (`/docs`), Zod-validated DTOs (`nestjs-zod`), JWT auth, workspace-scoped RBAC, API keys for the public API, MCP server endpoint (`/mcp`, Streamable HTTP).
- **apps/worker**: same Nest application context, runs BullMQ processors only. Scale horizontally.
- **packages/db**: Prisma schema + client (Postgres). JSONB for cell values, column configs, workflow graphs.
- **packages/providers**: provider adapter SDK + adapters (mock, Hunter, Prospeo, Datagma, Apollo, People Data Labs, HTTP, LLM via OpenAI/Anthropic).
- **packages/shared**: Zod schemas shared by API/web/CLI, formula engine, column-type registry.
- **packages/cli**: `gtm` CLI (device-code login, searches, run functions, workflows, tables).
- **Infra**: Postgres 16 + Redis 7 via `docker-compose.yml`. Queues: BullMQ. Secrets (provider keys) encrypted at rest with AES-256-GCM using `ENCRYPTION_KEY`.

## Execution model

Every cell in an enrichment/agent/formula/http column is computed by a **CellJob** on the `cells` queue:

```
enqueue(rowId, columnId) -> worker loads row + column config
  -> resolves input bindings ({{Column Name}} templates against the row)
  -> if column has runCondition (formula) and it is falsy: status=skipped
  -> executor for column.kind runs:
       enrichment : one provider adapter call
       waterfall  : ordered provider list, stop at first result passing `accept` (e.g. verified email)
       agent      : LLM tool-loop (web_search, fetch_page, extract) with structured output schema
       formula    : sandboxed expression engine (no network), synchronous
       http       : arbitrary HTTP request with templated url/headers/body, JSON path output
       function   : invokes a versioned Function (a saved column-group program)
  -> writes Cell {value, status: queued|running|done|error|skipped, error, provider, creditsUsed, provenance, durationMs}
  -> debits CreditLedger, emits `cell.updated` event (SSE to the grid)
  -> enqueues dependent columns (columns whose bindings reference this column)
```

Concurrency is per worker (`CELL_CONCURRENCY`, default 20); per-provider rate limiting via a Redis token bucket.

## Domain model (Prisma)

- **Workspace, User, Membership(role: owner|admin|member|viewer), ApiKey**
- **Connection** (provider, name, encrypted credentials, createdBy) — Connections page traces usage.
- **Table, Column** (name, type: text|number|boolean|date|url|email|json; kind: input|enrichment|waterfall|agent|formula|http|function; config JSONB; runCondition; colorLabel; position), **Row** (position), **Cell** (rowId, columnId, value JSONB, status, error, provider, creditsUsed, provenance JSONB).
- **Audience layer**: Company, Contact (600 string / 200 num/date/bool custom fields as JSONB with a per-workspace FieldDefinition table), DataSource (csv|crm|warehouse|table), Segment (saved filter tree), SegmentMembership.
- **Signals**: SignalDefinition (type: job_change|new_hire|funding|website_visit|custom; config), SignalEvent (contactId/companyId, payload, occurredAt).
- **Workflows**: Workflow (graph JSONB: nodes[trigger|enrich|agent|condition|score|route|action|delay], edges), WorkflowRun, StepRun (credits, input/output, status).
- **Functions**: Function, FunctionVersion (program JSONB = ordered column definitions), FunctionRun; tags; test cases.
- **Sequencer**: Inbox (SMTP/IMAP or provider), Sequence, SequenceStep, Campaign, Enrollment, Message, Reply.
- **Ads**: AdAudience, AdPlatformSync.
- **Credits**: CreditLedger (workspaceId, delta, reason, refType/refId), CreditBudget (scope, limit, period), UsageSnapshot.
- **Template** (kind: table|workflow, definition JSONB).

## Provider adapter SDK (`packages/providers`)

```ts
interface Provider {
  id: string;                        // 'hunter'
  name: string;
  auth: { type: 'apiKey'; fields: [{ key: 'apiKey'; label: string; secret: true }] };
  actions: ProviderAction[];
}
interface ProviderAction<I, O> {
  id: string;                        // 'hunter.findEmail'
  name: string;
  category: 'work_email' | 'personal_email' | 'phone' | 'person' | 'company' | 'verify' | 'search' | 'ai' | 'other';
  input: z.ZodType<I>;               // drives the column config form
  output: z.ZodType<O>;
  creditCost: number;                // internal credits charged when result found
  run(input: I, ctx: { credentials: Record<string,string>; fetch: typeof fetch; logger }): Promise<ActionResult<O>>;
}
type ActionResult<O> = { found: true; data: O; raw?: unknown } | { found: false; reason?: string } ;
```

Waterfalls are just `ProviderAction[]` of the same category plus an `accept(data)` predicate.

## Public API / CLI / MCP

- `/v1/*` REST with `Authorization: Bearer <api key>`; same handlers as the UI.
- CLI: `gtm login` (device code), `gtm search people|companies`, `gtm run function <id>`, `gtm workflow run <id>`, `gtm table rows <id>`.
- MCP server: tools `search_people`, `search_companies`, `enrich_contact`, `run_function`, `research_company` — governed by workspace budgets.

## Phases

1. Foundation: monorepo, DB schema, auth/workspaces, Tables + cell engine, providers (mock + Hunter/Prospeo/Datagma/Apollo/PDL + LLM agent), waterfall/formula/http columns, CSV import/export, Connections, credit ledger, SSE live grid.
2. Audiences (CSV/HubSpot/Salesforce/CSV-warehouse import, segments), Signals, Workflows canvas + runner, Functions (versions, tests, observability), templates.
3. Sequencer (inboxes, warmup stub, campaigns, AI copy, replies), Ads audiences sync, CRM write-back, public API keys + CLI + MCP, usage dashboard/budgets/spike alerts.
