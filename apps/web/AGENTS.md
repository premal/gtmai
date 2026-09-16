# apps/web

Next.js 15 App Router, client-side data fetching against `NEXT_PUBLIC_API_URL`
(Bearer JWT from `auth.tsx`).

## Page map

| Route                           | Shows                                                 |
| ------------------------------- | ----------------------------------------------------- |
| `/`                             | workspace home — folder/workbook/table nav tree       |
| `/tables/[id]`                  | the live grid (SSE-driven cell updates) — core screen |
| `/workbooks/[id]`               | workbook detail: tables, views, members               |
| `/audiences`                    | companies/contacts/segments                           |
| `/signals`                      | signal definitions + event feed                       |
| `/workflows`, `/workflows/[id]` | workflow list + node-graph editor/run view            |
| `/functions`, `/functions/[id]` | function registry + version detail                    |
| `/sequences`                    | outbound sequences + steps                            |
| `/campaigns`                    | campaigns + enrollments                               |
| `/ads`                          | ad audiences + sync status                            |
| `/crm`                          | CRM sync jobs/runs                                    |
| `/settings`                     | settings directory — cards linking to sub-pages       |
| `/settings/integrations`        | provider credentials                                  |
| `/settings/team`                | members, roles, invite links                          |
| `/templates`                    | built-in table templates                              |
| `/credits`                      | credit ledger + budgets                               |
| `/invite/[token]`               | accept a team invite (the only signup path)           |
| `/login`                        | themed split-screen login — no register               |

## Conventions

- **All styling is `app/globals.css`** — a hand-rolled design system
  (warm-stone/emerald, `--color-*` tokens, `@layer components`). There is no
  working Tailwind setup despite `tailwind.config.ts`; markup uses bespoke
  class names (`.data-grid`, `.card`, `.workflow-node`, …), not utilities.
- Geist fonts load via `next/font` variables on `<body>` in `layout.tsx`;
  the CSS references them as literal `'Geist'`/`'Geist Mono'` names.
- `auth.tsx` is a client-side guard reading `gtmai-token`/`gtmai-workspace`
  from localStorage; every page fetches with `Authorization: Bearer`.
- The grid subscribes to `GET /tables/:id/events` (SSE) for live cell updates —
  don't poll `/cells` in a loop.
- Imports `@gtmai/shared` for filter/sequence/template types.

## Checks gotchas

- `typecheck` uses `tsconfig.check.json`: narrows `include` to `app/**`
  (avoids racing `next build`'s `.next/types`) and maps `@gtmai/shared` to
  `src/` so it doesn't need a prebuilt `dist`.
- The Dockerfile builds with `--filter @gtmai/web...` so shared's `dist`
  exists before `next build` — keep the `...` suffix.
