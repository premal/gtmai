# packages/providers

Provider SDK and adapters. `types.ts` defines `Provider`/`ProviderAction`
with zod IO schemas; `index.ts` is the registry the api/worker import.

## Adapters

| Provider                | Actions                                                    |
| ----------------------- | ---------------------------------------------------------- |
| `mock`                  | deterministic fake data — used by tests/seed, no network   |
| `hunter`                | email find/verify                                          |
| `theirstack`            | job-posting signals                                        |
| `llm`                   | `llm.chat` — agent/tool loop for `agent` columns           |
| `rest`                  | `http.request` — generic templated HTTP for `http` columns |
| `smtp`                  | send mail via nodemailer (outbound)                        |
| `meta`                  | hashed audience upload (ads)                               |
| `hubspot`, `salesforce` | CRM write-back                                             |

## Conventions

- Actions declare `creditCost` and `accepted()`; waterfall columns rely on
  `accepted()` to decide whether to try the next provider.
- Credentials arrive decrypted — encryption/decryption lives in the api's
  connections module and the worker's `decryptCredentials`, not here.
- Tests are hermetic vitest (per-file `unit_*` Bazel targets), no services.
