ALTER TABLE "CreditLedger" ADD COLUMN "provider" TEXT;
CREATE INDEX "CreditLedger_workspaceId_provider_createdAt_idx"
  ON "CreditLedger"("workspaceId", "provider", "createdAt");
