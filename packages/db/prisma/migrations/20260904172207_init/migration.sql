-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('owner', 'admin', 'member', 'viewer');

-- CreateEnum
CREATE TYPE "ColumnType" AS ENUM ('text', 'number', 'boolean', 'date', 'url', 'email', 'json');

-- CreateEnum
CREATE TYPE "ColumnKind" AS ENUM ('input', 'enrichment', 'waterfall', 'agent', 'formula', 'http', 'function');

-- CreateEnum
CREATE TYPE "CellStatus" AS ENUM ('queued', 'running', 'done', 'error', 'skipped');

-- CreateEnum
CREATE TYPE "DataSourceType" AS ENUM ('csv', 'crm', 'warehouse', 'table');

-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('job_change', 'new_hire', 'funding', 'website_visit', 'custom');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('queued', 'running', 'done', 'error', 'skipped');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'member',

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encryptedCredentials" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Table" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Column" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ColumnType" NOT NULL,
    "kind" "ColumnKind" NOT NULL,
    "config" JSONB NOT NULL,
    "runCondition" TEXT,
    "colorLabel" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Column_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Row" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cell" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "value" JSONB,
    "status" "CellStatus" NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "provider" TEXT,
    "creditsUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "provenance" JSONB,
    "durationMs" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldDefinition" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "FieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DataSourceType" NOT NULL,
    "config" JSONB NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filter" JSONB NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SegmentMembership" (
    "id" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,

    CONSTRAINT "SegmentMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalDefinition" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SignalType" NOT NULL,
    "config" JSONB NOT NULL,

    CONSTRAINT "SignalDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalEvent" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "graph" JSONB NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'queued',
    "input" JSONB,
    "output" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepRun" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'queued',
    "credits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "input" JSONB,
    "output" JSONB,

    CONSTRAINT "StepRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Function" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Function_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunctionVersion" (
    "id" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "program" JSONB NOT NULL,
    "testCases" JSONB,

    CONSTRAINT "FunctionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunctionRun" (
    "id" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'queued',
    "input" JSONB,
    "output" JSONB,

    CONSTRAINT "FunctionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inbox" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,

    CONSTRAINT "Inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inboxId" TEXT,
    "name" TEXT NOT NULL,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "delayHours" INTEGER NOT NULL,
    "subjectTemplate" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reply" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdAudience" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,

    CONSTRAINT "AdAudience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdPlatformSync" (
    "id" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "externalId" TEXT,

    CONSTRAINT "AdPlatformSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tableId" TEXT,
    "delta" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditBudget" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "limit" DOUBLE PRECISION NOT NULL,
    "period" TEXT NOT NULL,

    CONSTRAINT "CreditBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tableId" TEXT,
    "period" TIMESTAMP(3) NOT NULL,
    "credits" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "UsageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "definition" JSONB NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_workspaceId_userId_key" ON "Membership"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "Connection_workspaceId_provider_idx" ON "Connection"("workspaceId", "provider");

-- CreateIndex
CREATE INDEX "Table_workspaceId_idx" ON "Table"("workspaceId");

-- CreateIndex
CREATE INDEX "Column_tableId_position_idx" ON "Column"("tableId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Column_tableId_name_key" ON "Column"("tableId", "name");

-- CreateIndex
CREATE INDEX "Row_tableId_position_idx" ON "Row"("tableId", "position");

-- CreateIndex
CREATE INDEX "Cell_columnId_status_idx" ON "Cell"("columnId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Cell_rowId_columnId_key" ON "Cell"("rowId", "columnId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldDefinition_workspaceId_name_key" ON "FieldDefinition"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SegmentMembership_segmentId_contactId_key" ON "SegmentMembership"("segmentId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "FunctionVersion_functionId_version_key" ON "FunctionVersion"("functionId", "version");

-- CreateIndex
CREATE INDEX "CreditLedger_workspaceId_createdAt_idx" ON "CreditLedger"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageSnapshot_workspaceId_tableId_period_key" ON "UsageSnapshot"("workspaceId", "tableId", "period");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Column" ADD CONSTRAINT "Column_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Row" ADD CONSTRAINT "Row_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cell" ADD CONSTRAINT "Cell_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "Row"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cell" ADD CONSTRAINT "Cell_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "Column"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldDefinition" ADD CONSTRAINT "FieldDefinition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SegmentMembership" ADD CONSTRAINT "SegmentMembership_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SegmentMembership" ADD CONSTRAINT "SegmentMembership_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalDefinition" ADD CONSTRAINT "SignalDefinition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalEvent" ADD CONSTRAINT "SignalEvent_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "SignalDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalEvent" ADD CONSTRAINT "SignalEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalEvent" ADD CONSTRAINT "SignalEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRun" ADD CONSTRAINT "StepRun_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Function" ADD CONSTRAINT "Function_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunctionVersion" ADD CONSTRAINT "FunctionVersion_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "Function"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunctionRun" ADD CONSTRAINT "FunctionRun_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "Function"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inbox" ADD CONSTRAINT "Inbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAudience" ADD CONSTRAINT "AdAudience_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdPlatformSync" ADD CONSTRAINT "AdPlatformSync_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "AdAudience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditBudget" ADD CONSTRAINT "CreditBudget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageSnapshot" ADD CONSTRAINT "UsageSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageSnapshot" ADD CONSTRAINT "UsageSnapshot_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
