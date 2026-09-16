#!/usr/bin/env bash
# Bazel test wrapper for non-hermetic targets: run a pnpm command from the
# repository root. Targets using this must be tagged local + no-sandbox; the
# runfiles are symlinks into the real source tree, and .bazelrc passes through
# PATH/HOME so pnpm and node resolve normally.
set -euo pipefail

cd "$(dirname "$(realpath "$0")")/../.."
exec pnpm "$@"
