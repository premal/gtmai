# packages/db

Prisma schema, migrations, and seed. String `cuid()` PKs everywhere; the
full model inventory grouped by domain is in the root `AGENTS.md`.

Key relations: `Workspace → Folder → Workbook → Table → {Column, Row, View}`;
`Cell` joins `Row × Column` and carries `status`, `value`, `error`,
`creditsUsed`. `Column.kind` (`ColumnKind` enum) picks the worker executor;
`Column.config` is JSON matching `shared/schemas.ts`. `Segment.filter` is the
`shared/filter.ts` DSL. `Workflow.graph` is the `shared/workflows.ts` DAG.

## Conventions

- The generated client lands in the pnpm store
  (`node_modules/.pnpm/@prisma+client*/node_modules/.prisma`), which Bazel
  can't populate — targets needing it run through `tools/bazel/dbgen.sh`
  (serialized behind `/tmp/gtmai-prisma-generate.lock` with a stamp file).
- `prisma/seed.ts` is idempotent: it deletes and recreates the `Prospects`
  table, then enqueues its cells — so it needs a reachable `REDIS_URL` too.
- `seed.ts` has its own `tsconfig.seed.json` and `typecheck:seed` script
  (it lives outside `src/`); `//packages/db:typecheck_seed` covers it.
- Migrations deploy via the api app's fly `release_command`
  (`prisma migrate deploy`) — never point them at a non-local DB by hand.
