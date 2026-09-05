ALTER TABLE "Company" ADD COLUMN "domainKey" TEXT;
ALTER TABLE "Contact" ADD COLUMN "emailKey" TEXT;
ALTER TABLE "SignalDefinition" ADD COLUMN "secret" TEXT;
ALTER TABLE "SignalDefinition" ADD COLUMN "triggerWorkflowId" TEXT;
ALTER TABLE "Workflow" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Workflow" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Template" ALTER COLUMN "workspaceId" DROP NOT NULL;

CREATE UNIQUE INDEX "Company_workspaceId_domainKey_key" ON "Company"("workspaceId", "domainKey");
CREATE INDEX "Company_workspaceId_domain_idx" ON "Company"("workspaceId", "domain");
CREATE UNIQUE INDEX "Contact_workspaceId_emailKey_key" ON "Contact"("workspaceId", "emailKey");
CREATE INDEX "Contact_workspaceId_email_idx" ON "Contact"("workspaceId", "email");
CREATE INDEX "Segment_workspaceId_idx" ON "Segment"("workspaceId");
CREATE INDEX "SignalDefinition_workspaceId_type_idx" ON "SignalDefinition"("workspaceId", "type");
CREATE INDEX "SignalEvent_definitionId_occurredAt_idx" ON "SignalEvent"("definitionId", "occurredAt");
CREATE INDEX "SignalEvent_contactId_occurredAt_idx" ON "SignalEvent"("contactId", "occurredAt");
CREATE INDEX "SignalEvent_companyId_occurredAt_idx" ON "SignalEvent"("companyId", "occurredAt");
CREATE INDEX "Workflow_workspaceId_createdAt_idx" ON "Workflow"("workspaceId", "createdAt");
CREATE INDEX "Template_workspaceId_kind_idx" ON "Template"("workspaceId", "kind");
