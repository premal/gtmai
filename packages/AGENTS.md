# packages

- `db` — Prisma schema/migrations/seed + generated client
- `providers` — provider SDK + adapters (mock, hunter, prospeo, datagma,
  apollo, peopledatalabs, theirstack, hginsights; LLMs: openai, anthropic,
  gemini, perplexity, openrouter, cometapi; search: tavily, exa, parallel;
  utility: rest, smtp, meta, hubspot, salesforce)
- `shared` — pure-TS lib (formula evaluator, bindings, filter DSL, workflow
  graph, sequence templates) imported by all three apps
- `cli`, `mcp` — standalone bins over the public API (API-key auth)
