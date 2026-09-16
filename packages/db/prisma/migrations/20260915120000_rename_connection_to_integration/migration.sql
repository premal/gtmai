-- RenameTable
ALTER TABLE "Connection" RENAME TO "Integration";

-- RenameConstraints
ALTER TABLE "Integration" RENAME CONSTRAINT "Connection_pkey" TO "Integration_pkey";
ALTER TABLE "Integration" RENAME CONSTRAINT "Connection_workspaceId_fkey" TO "Integration_workspaceId_fkey";
ALTER TABLE "Integration" RENAME CONSTRAINT "Connection_createdById_fkey" TO "Integration_createdById_fkey";

-- RenameIndex
ALTER INDEX "Connection_workspaceId_provider_idx" RENAME TO "Integration_workspaceId_provider_idx";
