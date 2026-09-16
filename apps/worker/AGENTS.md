# apps/worker

BullMQ consumers. `main.ts` boots the `cells` worker + `startPhase2Workers()`
(signals, workflows, outbound, ads, crm, usage — all in `phase2-worker.ts`).

## Cell pipeline (`main.ts` → `executors.ts`)

Each `cells` job = one (rowId, columnId) pair:

1. Load column + row, resolve `{{Column}}` bindings via `shared/bindings.ts`.
2. **Skip conditions** (write `status: skipped`, publish, return):
   `column.runCondition` formula falsy · budget exceeded (`budgets.ts` →
   workspace/table/provider scopes) · waterfall "missing inputs".
3. Execute by `column.kind` — see table below.
4. Write `Cell { status, value, error, creditsUsed, durationMs }`, debit
   `CreditLedger`, publish `{ rowId, columnId, status, … }` to `table:<id>`.

| `column.kind`      | Executor                                                                                                                                                                                                                                      | Credit cost                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `input`, `formula` | inline / `evaluateWorkerFormula` (shared evaluator, no `eval`)                                                                                                                                                                                | 0                          |
| `enrichment`       | `executeEnrichment` — single provider action                                                                                                                                                                                                  | 1 (or `config.creditCost`) |
| `waterfall`        | `executeWaterfall` — try providers in `config.providers[]` order, stop at first accepted result; `config.validate` runs a verify-category action on each result first (`{{result.*}}` binds the found data); charge winner + validation calls | winner's cost + validation |
| `http`             | `executeHttp` — templated request via `rest` provider                                                                                                                                                                                         | 1                          |
| `agent`            | `executeAgent` — LLM w/ tool loop; `config.provider` picks the integration (`openai`/`anthropic`/`gemini`/`perplexity`/`openrouter`/`cometapi`); a `tavily` integration enables the web_search tool                                           | 5                          |
| `function`         | runs a `Function` version's JS                                                                                                                                                                                                                | 1                          |

`config.maxCost` (any kind) skips the cell when the estimated credit cost
exceeds it — the per-run cap shown as "max cost" in the column editor.

Credentials: `decryptCredentials` (AES-256-GCM, `ENCRYPTION_KEY`) — the api
stores them encrypted; only the worker sees plaintext.

## Phase-2+ processors (`phase2-worker.ts`)

- `signals` — `pollSignal`: pull sources for due `SignalDefinition`s, emit
  `SignalEvent`s, fire workflow triggers. `config.sourceTableId` scopes the
  poll to a table's rows (domain/email columns auto-detected or pinned via
  `config.domainColumn`/`emailColumn`); `config.alertChannelId` posts new
  events to an `AlertChannel` webhook and writes an `Alert` row.
- `workflows` — `runWorkflow`: execute a `WorkflowRun`'s DAG step-by-step
  (re-enqueues per step; `StepRun` rows track state).
- `outbound` — sequence/campaign steps: send via `Inbox`, schedule the next
  `SequenceStep` with BullMQ `delay`, ingest replies.
- `ads` — push `Segment` membership to `AdAudience`s (hashed PII → Meta).
- `crm` — `CrmSyncJob` write-back batches (hubspot/salesforce adapters).
- `usage` — periodic `UsageSnapshot` rollups.

## Conventions

- Every Redis connection sets `family: 0` (fly `.internal` is IPv6-only).
- Agent cells fail fast with `No integration for <provider>` when the
  workspace hasn't added credentials — expected, not a bug.
- `CELL_CONCURRENCY` / `PROVIDER_RATE_LIMIT` tune throughput.

## Tests

Tests import `./main`, which constructs a `PrismaClient` — needs the
generated client (the bazel `dbgen.sh` wrapper handles it) but no live
services; `NODE_ENV=test` keeps `startWorker()` from running.
