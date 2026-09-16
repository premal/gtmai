# apps/web

Next.js 15 App Router, client-side data fetching against `NEXT_PUBLIC_API_URL`.

## Conventions

- **All styling is `app/globals.css`** — a hand-rolled design system
  (warm-stone/emerald, `--color-*` tokens, `@layer components`). There is no
  working Tailwind setup despite `tailwind.config.ts`; markup uses bespoke
  class names (`.data-grid`, `.card`, `.workflow-node`, …), not utilities.
- Geist fonts load via `next/font` variables on `<body>` in `layout.tsx`;
  the CSS references them as literal `'Geist'`/`'Geist Mono'` names.
- `auth.tsx` is a client-side guard reading `gtmai-token`/`gtmai-workspace`
  from localStorage; API calls send `Authorization: Bearer`.
- Login is **invite-only** — no register tab. `/invite/[token]` accepts
  invites into an existing workspace.
- Imports `@gtmai/shared` for filter/sequence/template types.

## Checks gotchas

- `typecheck` uses `tsconfig.check.json`: narrows `include` to `app/**`
  (avoids racing `next build`'s `.next/types`) and maps `@gtmai/shared` to
  `src/` so it doesn't need a prebuilt `dist`.
- The Dockerfile builds with `--filter @gtmai/web...` so shared's `dist`
  exists before `next build` — keep the `...` suffix.
