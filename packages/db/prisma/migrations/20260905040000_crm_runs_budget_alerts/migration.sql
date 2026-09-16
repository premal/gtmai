CREATE TABLE "CrmSyncRun" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "stats" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "error" TEXT,
  CONSTRAINT "CrmSyncRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CrmSyncRun_jobId_startedAt_idx" ON "CrmSyncRun"("jobId", "startedAt");
ALTER TABLE "CrmSyncRun" ADD CONSTRAINT "CrmSyncRun_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "CrmSyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "Alert_dedupeKey_key" ON "Alert"("dedupeKey");
