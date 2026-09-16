#!/bin/sh
set -e
cd /app/packages/db
pnpm exec prisma migrate deploy
cd /app
exec node "${ENTRY:-apps/api/dist/main.js}"
