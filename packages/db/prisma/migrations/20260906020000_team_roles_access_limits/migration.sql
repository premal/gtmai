-- Rename the existing membership role without rewriting membership rows.
ALTER TYPE "MembershipRole" RENAME VALUE 'member' TO 'editor';
ALTER TABLE "Membership" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TYPE "WorkbookAccess" AS ENUM ('workspace', 'restricted');

ALTER TABLE "Workbook"
  ADD COLUMN "access" "WorkbookAccess" NOT NULL DEFAULT 'workspace';

CREATE TABLE "WorkbookCollaborator" (
  "workbookId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "WorkbookCollaborator_pkey" PRIMARY KEY ("workbookId", "userId"),
  CONSTRAINT "WorkbookCollaborator_workbookId_fkey"
    FOREIGN KEY ("workbookId") REFERENCES "Workbook"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkbookCollaborator_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "WorkbookCollaborator_userId_idx" ON "WorkbookCollaborator"("userId");

CREATE TABLE "Invite" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "MembershipRole" NOT NULL,
  "token" TEXT NOT NULL,
  "invitedById" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invite_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Invite_token_key" UNIQUE ("token"),
  CONSTRAINT "Invite_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Invite_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Invite_workspaceId_email_idx" ON "Invite"("workspaceId", "email");
