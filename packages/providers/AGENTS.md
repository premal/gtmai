# packages/providers

Provider SDK and adapters. `types.ts` defines `Provider`/`ProviderAction`
with zod IO schemas; `index.ts` is the registry the api/worker import.

## Adapters

| Provider                                      | Actions                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `mock`                                        | deterministic fake data — used by tests/seed, no network                      |
| `hunter`                                      | email find/verify, domain search, company enrich                              |
| `prospeo`                                     | email/mobile finder, company enrich                                           |
| `datagma`                                     | full person enrichment                                                        |
| `apollo`                                      | people match/search, org enrich                                               |
| `peopledatalabs`                              | person/company enrich                                                         |
| `theirstack`                                  | company tech stack, companies-by-technology search                            |
| `hginsights`                                  | company technographics, company search, intent signals                        |
| `openai`, `anthropic`, `gemini`, `perplexity` | `<id>.chat` — LLM chat + the agent/tool loop for `agent` columns (`runAgent`) |
| `rest`                                        | `http.request` — generic templated HTTP for `http` columns                    |
| `smtp`                                        | send mail via nodemailer (outbound)                                           |
| `meta`                                        | hashed audience upload (ads)                                                  |
| `hubspot`, `salesforce`                       | CRM write-back                                                                |

## Conventions

- Actions declare `creditCost` and `accepted()`; waterfall columns rely on
  `accepted()` to decide whether to try the next provider.
- Credentials arrive decrypted — encryption/decryption lives in the api's
  integrations module and the worker's `decryptCredentials`, not here.
- A provider may implement `check(ctx)` to validate credentials — the
  integrations `/test` endpoint calls it (hunter → `/v2/account`,
  apollo → `/v1/auth/health`, hginsights → `/credits`); otherwise the
  endpoint probes the first action and interprets 401/403 as rejection.
- Tests are hermetic vitest (per-file `unit_*` Bazel targets), no services.
