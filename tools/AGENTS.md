# tools/bazel

Non-hermetic test wrappers — they run in the real source tree, so targets
using them must be tagged `local`, `no-sandbox`, `requires-network`.

- `pnpm.sh` — plain `pnpm "$@"` passthrough from the repo root.
- `dbgen.sh` — for targets needing the Prisma client or workspace `dist/`:
  regenerates the client + builds `shared`/`providers`/`db` under
  `/tmp/gtmai-prisma-generate.lock` with stamp files (skips when fresh).
- `itest.sh` — boots ephemeral Postgres+Redis docker containers per target,
  applies migrations, runs one package's vitest. Refuses a non-local
  `DATABASE_URL`; requires a working docker daemon.
