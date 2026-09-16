#!/usr/bin/env bash
# Benchmark for the Bazel pilot: compare full-suite execution against
# affected-test execution, and report the one-time setup cost.
#
# Usage:
#   scripts/bazel-benchmark.sh [base-ref]
#
# Prerequisites: pnpm install, bazel (via bazelisk), docker running.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${1:-main}"

time_cmd() {
  local label="$1"; shift
  local start end
  start=$(date +%s)
  "$@" || true
  end=$(date +%s)
  echo "| $label | $((end - start))s |"
}

echo "=== Bazel pilot benchmark (base: $BASE) ==="
echo
echo "Setup (one-time / maintenance):"
time_cmd "pnpm install (shared with existing flow)" pnpm install --frozen-lockfile
time_cmd "bazel warm-up (bazel query //...)" bazel query //...

echo
echo "Test execution:"
time_cmd "existing: pnpm test+lint+typecheck" sh -c 'pnpm typecheck && pnpm lint && pnpm test'
time_cmd "bazel full suite: bazel test //..." bazel test //...
time_cmd "bazel affected: scripts/bazel-affected.sh $BASE" scripts/bazel-affected.sh "$BASE"

echo
echo "Notes:"
echo "- Re-run with a small source change vs $BASE to see the affected-vs-full gap."
echo "- //apps/api:itest starts ephemeral Postgres + Redis containers; its wall"
echo "  time dominates when run under Bazel alongside the cheap targets."
