# packages/providers

Provider SDK and adapters. `types.ts` defines `Provider`/`ProviderAction`
with zod IO schemas; `index.ts` is the registry the api/worker import.

## Conventions

- Adapters: `mock` (deterministic, no network — used by tests/seed),
  `hunter`, `theirstack`, `llm`, `rest`, `smtp` (nodemailer), `meta` (ads).
- Actions declare `creditCost` and `accepted()`; waterfall columns rely on
  `accepted()` to decide whether to try the next provider.
- Credentials arrive decrypted — encryption/decryption lives in the api's
  connections module, not here.
- Tests are hermetic vitest (per-file `unit_*` Bazel targets), no services.
