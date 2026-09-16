# packages/shared

Pure TS shared by web/api/worker. No runtime deps beyond zod.

## Conventions

- `formula.ts` — hand-written safe expression evaluator; understands
  `{{Column}}` refs natively. Never use `eval`.
- `bindings.ts` — resolves `{{…}}` references against row data.
- `filter.ts` — segment filter DSL → Prisma `where` for scalar fields,
  bounded in-memory predicate for JSON paths (documented limitation).
- `workflows.ts`/`sequences.ts` — workflow graph + sequence template types;
  built-in templates are JSON under `src/templates/`.
- Consumers resolve this package via `dist/` (`main`/`types`) — it must be
  built before api/worker typecheck (the bazel wrappers do it; web's
  `tsconfig.check.json` maps here instead).
- Per-file `unit_*` vitest targets in `BUILD.bazel` — add one per new
  `*.test.ts`.
