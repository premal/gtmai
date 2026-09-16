# scripts

- `bazel-affected.sh` — maps changed files (vs a base ref) to affected test
  targets via `bazel query rdeps`. Fail-safe: config/graph/deleted/unmapped
  changes run the full `//...` suite.
- `bazel-benchmark.sh` — times the Bazel suite for comparisons.
