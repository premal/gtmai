# packages

- `db` — Prisma schema/migrations/seed + generated client
- `providers` — provider SDK + adapters (mock, hunter, theirstack, llm, smtp, meta)
- `shared` — pure-TS lib (formula evaluator, bindings, filter DSL, workflow
  graph, sequence templates) imported by all three apps
- `cli`, `mcp` — standalone bins over the public API (API-key auth)
