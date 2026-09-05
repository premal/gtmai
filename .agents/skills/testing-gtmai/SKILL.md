---
name: testing-gtmai
description: How to run and E2E-test the gtmai monorepo (Next.js web :3000, NestJS API :4000, BullMQ worker) locally in a browser.
---

# Testing gtmai locally

## Start services (reuse if ports already bound: `ss -ltnp | grep -E '3000|4000|5432|6379'`)

- `docker compose up -d` (Postgres `gtmai-postgres-1` :5432, Redis `gtmai-redis-1` :6379).
- `cp .env.example .env` if missing. `ENCRYPTION_KEY` MUST be 64 hex chars (32 bytes); a shorter key makes every enrichment cell fail with "Invalid key length". The worker now validates this at startup, so an old worker process with a stale env is the usual culprit — kill and restart it.
- Load env before each app: `set -a && . ./.env && set +a`, then run api/worker/web from their `apps/*` dirs (`npx pnpm@9 dev` or `npx next dev -p 3000`).
- Before Prisma commands from `packages/db`, load the repository environment in the same shell so a stale shell-level `DATABASE_URL` cannot override it: `set -a && . ../../.env && set +a && npx prisma migrate deploy --schema prisma/schema.prisma`; run the seed the same way with `set -a && . ../../.env && set +a && npx prisma db seed`.
- Export `.env` before every Prisma migration or seed command from `packages/db`; otherwise Prisma can use stale shell credentials and fail with P1000.
- API tests can create extra workspaces; when selecting test records, use the demo user's `workspaceId` rather than assuming the newest workspace.
- Never run `pnpm build` or `next build` in `apps/web` while the dev server is being used by a tester; the production build can clobber its `.next` output. Use CI or an isolated checkout/output directory for web build verification.
- If a web production build was accidentally run in the active checkout, remove `apps/web/.next` and restart the dev server before testing again.
- If Next.js throws `Cannot find module './NNN.js'`, stop the web dev process, run `rm -rf apps/web/.next`, and restart it.
- Restarting the API may invalidate the browser JWT (401s). Clear localStorage (`gtmai-token`) and log in again as `demo@gtmai.dev / demo1234`.
- Seed prints a one-time plaintext `gtm_` API key; use it for local CLI checks, but never reuse or store the plaintext in source control.
- Webhook CRM jobs require a `Connection` with provider `webhook` and encrypted credentials containing `credentials.url`.
- Delayed outbound step-2 jobs should be visible in the BullMQ `bull:outbound` delayed set.
- CLI login includes the API URL: `gtmai login --api-key <key> --url http://localhost:4000`.
- Build the CLI with `npx pnpm@9 --filter @gtmai/cli build`.

## Useful checks

- Seeded table "Prospects" has 20 rows; find its id via `docker exec gtmai-postgres-1 psql -U gtmai -d gtmai -c 'select id,name from "Table"'`.
- SSE: `curl -N -H 'Origin: http://localhost:3000' "localhost:4000/tables/<id>/events?token=<jwt>"` should return `text/event-stream`, CORS origin header and a leading `: ok`. If the grid never updates without refresh, check this first.
- Job status: Redis keys `bull:cells:<n>`; cell status/value in table `"Cell"`.
- To rerun one cell, use the cell detail drawer's rerun action; agent cells can take about two minutes. When a run fails, inspect the API response body for the underlying error message rather than relying only on the UI status.
- Credits ledger row count: `select count(*) from "CreditLedger"`.
- Swagger: http://localhost:4000/docs.

## Known pitfalls

- Connection "Test" result is shown in a native `alert()` dialog — dismiss it before continuing.
- CSV file-upload import sends `mapping` as a multipart field; the API reads mapping only from the JSON body, so the mapping may be ignored (creates new columns). Paste import honours mapping.

## Devin Secrets Needed

- none (local `.env` only; `TAVILY_API_KEY`/LLM keys optional for real providers).
