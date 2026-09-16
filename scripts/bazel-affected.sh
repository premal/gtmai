#!/usr/bin/env bash
# Selective test runner: run only the Bazel test targets affected by the
# current change set. Fails safe to `bazel test //...` whenever the change set
# can't be mapped cleanly onto the declared dependency graph.
#
# Usage:
#   scripts/bazel-affected.sh [base-ref]     # default base: main
#   BASE=origin/main scripts/bazel-affected.sh
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-${BASE:-main}}"

full() {
  echo "affected: $1 — running the full suite" >&2
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo "  //..." >&2
    exit 0
  fi
  exec bazel test //...
}

# Committed diff vs base + unstaged/staged working-tree changes + untracked.
{
  git diff --name-only --diff-filter=ACMR "${BASE}...HEAD" 2>/dev/null \
    || git diff --name-only --diff-filter=ACMR "$BASE"
  git diff --name-only --diff-filter=ACMR HEAD
  git ls-files --others --exclude-standard
} | sort -u > /tmp/gtmai-changed.$$

CHANGED=()
while IFS= read -r line; do
  [[ -n "$line" ]] && CHANGED+=("$line")
done < /tmp/gtmai-changed.$$
rm -f /tmp/gtmai-changed.$$
if [[ ${#CHANGED[@]} -eq 0 ]]; then
  echo "affected: no changes vs $BASE"
  exit 0
fi
echo "affected: ${#CHANGED[@]} changed file(s) vs $BASE" >&2

# Package/config/graph changes always run everything. Deleted files shift glob
# membership, so treat them as unknown.
for f in "${CHANGED[@]}"; do
  case "$f" in
    package.json|*/package.json|pnpm-lock.yaml|pnpm-workspace.yaml|\
    *.bazel|*.bzl|BUILD|BUILD.bazel|*/BUILD|*/BUILD.bazel|.bazelrc|.bazelignore|\
    *.config.*|*/tsconfig*.json|*.env*|Dockerfile|*/Dockerfile|fly.*.toml)
      full "package/config/graph change in $f" ;;
  esac
  if [[ ! -e "$f" ]]; then
    full "deleted or moved file $f"
  fi
done

# Map each changed file to its Bazel label: the package is the nearest ancestor
# directory containing a BUILD file, the label is the path relative to it.
# Anything unowned is an unknown dependency relationship → full suite.
LABELS=()
for f in "${CHANGED[@]}"; do
  d="$(dirname "$f")"
  while [[ "$d" != "." && "$d" != "/" && ! -f "$d/BUILD.bazel" && ! -f "$d/BUILD" ]]; do
    d="$(dirname "$d")"
  done
  if [[ "$d" == "." || "$d" == "/" ]]; then
    [[ -f BUILD.bazel || -f BUILD ]] || full "no Bazel target owns $f"
    d=""
  fi
  pkg="${d:-}"
  rel="${f#$d/}"
  lbl="//${pkg}:${rel}"
  # Confirm the label resolves inside a real Bazel package.
  bazel query "\"$lbl\"" >/dev/null 2>&1 || full "no Bazel target owns $f"
  LABELS+=("\"$lbl\"")
done

# Reverse deps: which test targets transitively depend on the changed files?
TESTS="$(bazel query "kind('.*_test', rdeps(//..., set(${LABELS[*]})))" 2>/dev/null || true)"
if [[ -z "$TESTS" ]]; then
  full "no test target reachable from the change set"
fi

echo "affected: running $(echo "$TESTS" | wc -l | tr -d ' ') target(s):" >&2
echo "$TESTS" | sed 's/^/  /' >&2
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  exit 0
fi
# shellcheck disable=SC2086
exec bazel test $TESTS
