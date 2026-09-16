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

client_present() {
  compgen -G \
    "node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/index.d.ts" \
    >/dev/null
}

if [[ ! -f "$STAMP" || "$SCHEMA" -nt "$STAMP" ]] || ! client_present; then
  tries=0
  until mkdir "$LOCK" 2>/dev/null; do
    sleep 1
    tries=$((tries + 1))
    if (( tries > 120 )); then rm -rf "$LOCK"; fi  # break a stale lock
  done
  pnpm --filter @gtmai/db exec prisma generate >/dev/null
  touch "$STAMP"
  rm -rf "$LOCK"
fi

exec pnpm "$@"
