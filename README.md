# GTM AI

Clay-style GTM data platform with a NestJS/Fastify API, BullMQ workers, Prisma
domain model, provider SDKs, a live SSE grid, CSV workflows, connections,
credits, Audiences, Signals, Workflows, Functions, and Templates.

## Setup

```bash
cp .env.example .env
docker compose up -d
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @gtmai/db prisma migrate dev
pnpm --filter @gtmai/db db:seed
pnpm dev
```

API runs on `http://localhost:4000`, web on `http://localhost:3000`, and Swagger is at `/docs`.
The seeded account is `demo@gtmai.dev` / `demo1234`.

The required local environment values are:

```text
DATABASE_URL=postgresql://gtmai:gtmai@localhost:5432/gtmai
REDIS_URL=redis://localhost:6379
JWT_SECRET=replace-me
ENCRYPTION_KEY=<64 hexadecimal characters>
NEXT_PUBLIC_API_URL=http://localhost:4000
```

After signing in, the Phase 2 sidebar exposes Audiences, Signals, Workflows,
Functions, and Templates. Signal definitions can poll the deterministic mock
provider, and workflow runs are processed by the shared Redis-backed worker.

For a larger local grid, seed 1,000 rows with:

```bash
pnpm --filter @gtmai/db db:seed -- --rows=1000
```

## Provider keys

Open **Connections** in the web workspace, choose a provider, and save its API key.
Keys are encrypted with `ENCRYPTION_KEY` and only masked metadata is returned by the API.
The mock provider works without a network key and is used by the seeded waterfall.
For a real provider, add a connection in **Connections** and enter the key
required by that provider's action. Never commit `.env` or provider keys.

## Screenshots

Manual smoke screenshots can be stored under `/home/ubuntu/gtmai-p1-*.png`.
The expected flow is: log in, add a waterfall column, run it, watch SSE updates,
open a completed cell drawer, import CSV, and test a mock connection.
