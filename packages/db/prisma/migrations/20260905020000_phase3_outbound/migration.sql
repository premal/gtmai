ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_sequenceId_position_key" UNIQUE ("sequenceId", "position");

ALTER TABLE "Campaign" ADD COLUMN "segmentId" TEXT,
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "Campaign_workspaceId_status_idx" ON "Campaign"("workspaceId", "status");
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Enrollment" ADD COLUMN "nextStepAt" TIMESTAMP(3);
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Enrollment_campaignId_contactId_key" ON "Enrollment"("campaignId", "contactId");
CREATE INDEX "Enrollment_campaignId_status_idx" ON "Enrollment"("campaignId", "status");

ALTER TABLE "Message" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'queued',
ADD COLUMN "error" TEXT,
ADD COLUMN "stepPosition" INTEGER;

ALTER TABLE "AdPlatformSync" ADD COLUMN "matched" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "uploaded" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "syncedAt" TIMESTAMP(3),
ADD COLUMN "error" TEXT;
CREATE UNIQUE INDEX "AdPlatformSync_audienceId_platform_key" ON "AdPlatformSync"("audienceId", "platform");

CREATE UNIQUE INDEX "CreditBudget_workspaceId_scope_period_key" ON "CreditBudget"("workspaceId", "scope", "period");
ALTER TABLE "UsageSnapshot" ADD COLUMN "provider" TEXT;

CREATE TABLE "CrmSyncJob" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "source" JSONB NOT NULL,
  "destination" JSONB NOT NULL,
  "schedule" TEXT,
  "lastRunAt" TIMESTAMP(3),
  "lastStats" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmSyncJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CrmSyncJob_workspaceId_updatedAt_idx" ON "CrmSyncJob"("workspaceId", "updatedAt");
ALTER TABLE "CrmSyncJob" ADD CONSTRAINT "CrmSyncJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CrmSyncRecord" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "externalKey" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmSyncRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrmSyncRecord_jobId_externalKey_key" ON "CrmSyncRecord"("jobId", "externalKey");
ALTER TABLE "CrmSyncRecord" ADD CONSTRAINT "CrmSyncRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmSyncRecord" ADD CONSTRAINT "CrmSyncRecord_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CrmSyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AlertChannel" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "AlertChannel_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AlertChannel" ADD CONSTRAINT "AlertChannel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Alert" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'warning',
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Alert_workspaceId_createdAt_idx" ON "Alert"("workspaceId", "createdAt");
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdAudience" ADD COLUMN "segmentId" TEXT,
ADD COLUMN "platforms" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "AdAudience" ADD CONSTRAINT "AdAudience_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
