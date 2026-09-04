# GTM AI

Clay-style GTM data platform foundation.

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
