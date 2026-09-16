# apps/worker

BullMQ consumers. `main.ts` boots the cell queue worker; `phase2-worker.ts`
adds the signals/workflows/outbound/ads processors.

## Conventions

- `executors.ts` implements the cell kinds: `formula` (safe evaluator in
  shared, no `eval`), `enrichment`, `waterfall`, `agent`, `http`.
  Waterfalls try providers in order and stop at the first `accepted()`
  result, charging only that provider's `creditCost`.
- `budgets.ts` enforces per-workbook/table spend limits before running cells.
- Publishes `table:<id>` events on Redis for the API's SSE stream.
- Every Redis connection sets `family: 0` (fly `.internal` is IPv6-only).
- Agent cells fail fast with `No connection for <provider>` when the
  workspace hasn't added credentials — that's expected, not a bug.

## Tests

Tests import `./main`, which constructs a `PrismaClient` — needs the
generated client (the bazel `dbgen.sh` wrapper handles it) but no live
services; `NODE_ENV=test` keeps `startWorker()` from running.
