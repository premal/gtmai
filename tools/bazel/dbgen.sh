#!/usr/bin/env bash
# Bazel test wrapper for targets that need the generated Prisma client:
# regenerate @gtmai/db's client in the real source tree, then run a pnpm
# command from the repository root. The generated client lives inside the
# pnpm store (node_modules/.pnpm/@prisma+client*/node_modules/.prisma), which
# Bazel cannot inject into a sandbox — targets using this wrapper must be
# tagged local + no-sandbox.
#
# Parallel Bazel targets must not regenerate while another target's tsc is
# reading the client, so generation is serialized behind a lock directory and
# skipped when the client is already up to date for the current schema.
set -euo pipefail

cd "$(dirname "$(realpath "$0")")/../.."

LOCK=/tmp/gtmai-prisma-generate.lock
STAMP=packages/db/node_modules/.gtmai-generated
SCHEMA=packages/db/prisma/schema.prisma

# Workspace deps resolve via main/types -> dist/, which Bazel doesn't build —
# compile them in the source tree first or consumers get TS2307 on a clean
# checkout. Serialized with generation under the same lock; the stamp skips
# the rebuild unless a package source changed.
DEPS_STAMP=node_modules/.gtmai-deps-built

client_present() {
  compgen -G \
    "node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/index.d.ts" \
    >/dev/null
}

gen_needed() {
  [[ ! -f "$STAMP" || "$SCHEMA" -nt "$STAMP" ]] || ! client_present
}

deps_stale() {
  [[ ! -f "$DEPS_STAMP" ]] && return 0
  [[ ! -f packages/shared/dist/index.d.ts ||
     ! -f packages/providers/dist/index.d.ts ||
     ! -f packages/db/dist/src/index.d.ts ]] && return 0
  find packages/shared/src packages/providers/src packages/db/src \
    -name '*.ts' -newer "$DEPS_STAMP" -print -quit | grep -q .
}

if gen_needed || deps_stale; then
  tries=0
  until mkdir "$LOCK" 2>/dev/null; do
    sleep 1
    tries=$((tries + 1))
    if (( tries > 120 )); then rm -rf "$LOCK"; fi  # break a stale lock
  done
  if gen_needed; then
    pnpm --filter @gtmai/db exec prisma generate >/dev/null
    touch "$STAMP"
  fi
  if deps_stale; then
    pnpm -r --filter @gtmai/shared --filter @gtmai/providers --filter @gtmai/db \
      run build >/dev/null
    touch "$DEPS_STAMP"
  fi
  rm -rf "$LOCK"
fi

exec pnpm "$@"
