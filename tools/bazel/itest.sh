#!/usr/bin/env bash
# Bazel integration-test wrapper: spin up ephemeral Postgres + Redis
# containers, apply Prisma migrations, run one package's vitest suite against
# them, then tear everything down.
#
# Safety: the databases are created by this script on 127.0.0.1 and the
# package is pointed at them explicitly. Tests never see a production
# DATABASE_URL/REDIS_URL.
set -euo pipefail

# Non-hermetic wrapper: runs against the real source tree (runfiles are
# symlinks back into it). .bazelrc passes PATH/HOME/DOCKER_HOST through so
# pnpm and the docker context resolve normally.
cd "$(dirname "$(realpath "$0")")/../.."

PKG="${1:?usage: itest.sh <pnpm package name> [extra vitest args]}"
shift || true

command -v docker >/dev/null || { echo "itest: docker is required" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "itest: cannot reach a docker daemon" >&2; exit 1; }

SUFFIX="$(echo "${TEST_TARGET:-$$}" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9' | cut -c1-24)"
[[ -z "$SUFFIX" ]] && SUFFIX="job$$"
PG="gtmai-itest-pg-${SUFFIX}-${RANDOM}"
REDIS="gtmai-itest-redis-${SUFFIX}-${RANDOM}"

cleanup() {
  docker rm -f "$PG" "$REDIS" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "$PG" \
  -e POSTGRES_USER=gtmai -e POSTGRES_PASSWORD=gtmai -e POSTGRES_DB=gtmai \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
docker run -d --name "$REDIS" -p 127.0.0.1::6379 redis:7-alpine >/dev/null
PG_PORT="$(docker port "$PG" 5432/tcp | sed 's/.*://')"
REDIS_PORT="$(docker port "$REDIS" 6379/tcp | sed 's/.*://')"

for _ in $(seq 1 60); do
  docker exec "$PG" pg_isready -U gtmai >/dev/null 2>&1 && break
  sleep 1
done
for _ in $(seq 1 30); do
  docker exec "$REDIS" redis-cli ping >/dev/null 2>&1 && break
  sleep 1
done

export DATABASE_URL="postgresql://gtmai:gtmai@127.0.0.1:${PG_PORT}/gtmai"
export REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"
export JWT_SECRET="itest-jwt-secret"
export ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
# CI=true keeps api tests from loading .env.test so the ephemeral URLs win.
export CI=true
export NODE_ENV=test

# Never run against a non-local database.
host="$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')"
if [[ "$host" != "127.0.0.1" && "$host" != "localhost" ]]; then
  echo "itest: refusing non-local DATABASE_URL host '$host'" >&2
  exit 1
fi

pnpm --filter @gtmai/db exec prisma migrate deploy

# Serialize with tools/bazel/dbgen.sh so a concurrent generate can't leave a
# half-written client while another target's tsc/vitest is reading it.
LOCK=/tmp/gtmai-prisma-generate.lock
STAMP=packages/db/node_modules/.gtmai-generated
tries=0
until mkdir "$LOCK" 2>/dev/null; do
  sleep 1
  tries=$((tries + 1))
  if (( tries > 120 )); then rm -rf "$LOCK"; fi
done
pnpm --filter @gtmai/db exec prisma generate >/dev/null
touch "$STAMP"
rm -rf "$LOCK"

pnpm --filter "$PKG" test "$@"
