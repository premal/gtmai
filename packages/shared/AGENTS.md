# packages/shared

Pure TS shared by web/api/worker. No runtime deps beyond zod.

## API surface

- `formula.ts` — `evaluateFormula(expr, row)`: hand-written safe expression
  evaluator; understands `{{Column}}` refs natively. Never use `eval`.
- `bindings.ts` — `resolveBindings(template, row)` interpolates `{{…}}`;
  `getPath`/`resolveBindingsDeep`/`findBindings` helpers.
- `filter.ts` — `Filter` DSL (zod `filterSchema`); `compileFilterWhere` →
  Prisma `where` for scalar fields; `compileFilterPredicate`/`evaluateFilter`
  → in-memory predicate for JSON paths (bounded — documented limitation).
- `schemas.ts` — zod `columnConfig` discriminated union on `kind`
  (input/enrichment/waterfall/agent/formula/http/function); the api validates
  and the worker executes against these shapes. Also `metapromptResult` /
  `generatedSequence` (LLM-generation payloads), `signalConfig` (signal
  definition config incl. `sourceTableId`/`schedule`/`alertChannelId`).
- `workflows.ts` — `workflowNodeTypes`, `workflowGraphSchema`,
  `topologicalOrder`, `validateWorkflowGraph(Detailed)` — the DAG the
  workflow engine runs.
- `sequences.ts` — `renderSequenceTemplate` + contact/company types.
- `templates.ts` — `builtInTemplates` (JSON under `src/templates/`).

## Conventions

- Consumers resolve this package via `dist/` (`main`/`types`) — it must be
  built before api/worker typecheck (the bazel wrappers do it; web's
  `tsconfig.check.json` maps to `src/` instead).
- Per-file `unit_*` vitest targets in `BUILD.bazel` — add one per new
  `*.test.ts`.
