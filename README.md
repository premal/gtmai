# GTM AI

Clay-style GTM data platform Phase 1 foundation. It includes a NestJS/Fastify API,
BullMQ worker, Prisma domain model, provider SDKs, a live SSE grid, CSV workflows,
connections, and credits.

## Setup

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm --filter @gtmai/db prisma migrate dev
pnpm --filter @gtmai/db db:seed
pnpm dev
```

API runs on `http://localhost:4000`, web on `http://localhost:3000`, and Swagger is at `/docs`.
The seeded account is `demo@gtmai.dev` / `demo1234`.

For a larger local grid, seed 1,000 rows with:

```bash
pnpm --filter @gtmai/db db:seed -- --rows=1000
```

## Provider keys

Open **Connections** in the web workspace, choose a provider, and save its API key.
Keys are encrypted with `ENCRYPTION_KEY` and only masked metadata is returned by the API.
The mock provider works without a network key and is used by the seeded waterfall.

## Screenshots

Manual smoke screenshots can be stored under `/home/ubuntu/gtmai-p1-*.png`.
The expected flow is: log in, add a waterfall column, run it, watch SSE updates,
open a completed cell drawer, import CSV, and test a mock connection.
