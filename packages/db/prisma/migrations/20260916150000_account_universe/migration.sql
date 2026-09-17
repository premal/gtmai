-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "linkedinUrl" TEXT,
    "industry" TEXT,
    "size" TEXT,
    "employees" INTEGER,
    "revenueUsdM" DOUBLE PRECISION,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT DEFAULT 'United States',
    "founded" INTEGER,
    "ticker" TEXT,
    "source" TEXT NOT NULL DEFAULT 'universe',
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_domain_key" ON "Account"("domain");

-- CreateIndex
CREATE INDEX "Account_industry_idx" ON "Account"("industry");

-- CreateIndex
CREATE INDEX "Account_state_idx" ON "Account"("state");

-- CreateIndex
CREATE INDEX "Account_size_idx" ON "Account"("size");

-- CreateIndex
CREATE INDEX "Account_employees_idx" ON "Account"("employees");

-- CreateIndex
CREATE INDEX "Account_revenueUsdM_idx" ON "Account"("revenueUsdM");

-- Fast substring search over 8M+ names
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE INDEX "Account_name_trgm_idx" ON "Account" USING gin ("name" gin_trgm_ops);
