# Bazel pilot — selective testing

This repo runs a **Bazel pilot** that wraps the existing pnpm scripts in Bazel
targets so `bazel query` can select only the tests affected by a change. pnpm
remains the package manager; the application and tooling are unchanged.

## Layout

- `MODULE.bazel`, `.bazelrc`, `.bazelignore`, `.bazelversion`, `BUILD.bazel` —
  workspace config.
- `packages/shared/BUILD.bazel`, `packages/providers/BUILD.bazel` — filegroups
  plus hermetic `unit_*` (vitest) and `lint` (eslint) targets, and local
  `typecheck`/`build` wrappers.
- `packages/db/BUILD.bazel` — `lint` plus local `typecheck`/`build` (needs the
  generated Prisma client).
- `apps/api/BUILD.bazel` — local `typecheck`/`build` plus `itest`, the API
  integration test backed by ephemeral Postgres + Redis containers.
- `apps/worker/BUILD.bazel` — local `unit_main`/`typecheck`/`build` (imports
  `PrismaClient`, so it needs the generated client).
- `apps/web/BUILD.bazel` — local `typecheck`/`build` (`next build` writes
  `.next`; no unit tests or lint script today).
- `tools/bazel/*.sh` — wrappers that cd to the repo root and run pnpm:
  `pnpm.sh` (plain), `dbgen.sh` (regenerates the Prisma client first),
  `itest.sh` (ephemeral Postgres + Redis + `prisma migrate deploy` per target).
- `scripts/bazel-affected.sh` — changed-file → affected-target selection.
- `scripts/bazel-benchmark.sh` — full vs affected timing comparison.

## Prerequisites

```sh
brew install bazelisk   # Bazel version is pinned by .bazelversion (8.x —
                        # Bazel 9 removed native sh_* rules that rules_js
                        # still uses)
pnpm install            # unchanged — pnpm remains the package manager; Bazel
                        # additionally links node_modules from pnpm-lock.yaml
                        # via aspect_rules_js for the hermetic targets
# Docker CLI is required for //apps/api:itest: each run starts its own
# postgres:16-alpine and redis:7-alpine containers. The dev stack
# (docker compose up -d) is only needed for `pnpm dev`, not for Bazel tests.
```

## Hermetic vs local targets

- **Hermetic** (run in the Bazel sandbox with Bazel-managed Node 22 and
  lockfile-derived node_modules): `unit_*` in `packages/*`, `lint`.
- **Semi-hermetic** (declared deps drive selection, execution runs against the
  real tree via wrappers): `typecheck`, `build`, `unit_main`, `itest`. They are
  tagged `local`/`no-sandbox` and get `PATH`/`HOME`/`DOCKER_HOST` via
  `--test_env` in `.bazelrc`.
- The generated Prisma client (`node_modules/.prisma`) is the main blocker for
  fully-sandboxed `tsc`/vitest in `@gtmai/db`, `@gtmai/api` and
  `@gtmai/worker`: rules_js can't inject generated files into the package
  store, so `dbgen.sh` regenerates it in the real tree. The real fix is a
  `prisma generate` Bazel action wired into `ts_project` — deferred.

## Running tests

```sh
bazel test //...                        # full suite
bazel test //packages/...               # all package tests
bazel test //packages/shared:unit_formula   # single vitest file
bazel test //apps/api:itest             # API integration test (needs docker)
scripts/bazel-affected.sh main          # only tests affected vs a base ref
DRY_RUN=1 scripts/bazel-affected.sh     # print the selection without running
```

## Dependency model

- File-level `filegroup`s per package (`srcs`, `config`, `prisma`) are the
  reverse-deps graph: `bazel-affected.sh` maps changed files to labels, runs
  `kind('.*_test', rdeps(//..., <labels>))`, and tests only what depends on
  the change.
- `//:workspace_config` (lockfile, workspace files, bazel files, wrapper
  scripts) is a dep of every target — touching it runs the full suite.
- `//apps/api:itest` deps on `//packages/db:prisma` + the `srcs` of
  `db`/`providers`/`shared`, so schema, migration and library changes re-run
  the API integration test.
- Unknown/unowned files (deleted files, paths no filegroup claims) fail safe
  to the full suite.
