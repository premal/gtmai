# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @gtmai/db exec prisma generate \
  && pnpm --filter @gtmai/api... build

FROM base AS runtime
COPY --from=build /app /app
ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
