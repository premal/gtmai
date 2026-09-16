ALTER TABLE "Table" ADD COLUMN "workbookId" TEXT;
ALTER TABLE "Table" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Workbook" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "folderId" TEXT,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workbook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "View" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filter" JSONB,
    "sort" JSONB NOT NULL DEFAULT '[]',
    "hiddenColumnIds" JSONB NOT NULL DEFAULT '[]',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "View_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TagAssignment" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "folderId" TEXT,
    "workbookId" TEXT,
    "tableId" TEXT,
    CONSTRAINT "TagAssignment_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Workbook" ("id", "workspaceId", "name", "position", "updatedAt")
SELECT md5('default-workbook:' || "Workspace"."id"), "Workspace"."id", 'Default workbook', 0, CURRENT_TIMESTAMP
FROM "Workspace"
WHERE EXISTS (
  SELECT 1 FROM "Table" WHERE "Table"."workspaceId" = "Workspace"."id"
);

UPDATE "Table"
SET "workbookId" = "Workbook"."id"
FROM "Workbook"
WHERE "Workbook"."workspaceId" = "Table"."workspaceId"
  AND "Workbook"."name" = 'Default workbook';

ALTER TABLE "Table" ALTER COLUMN "workbookId" SET NOT NULL;

CREATE INDEX "Table_workbookId_position_idx" ON "Table"("workbookId", "position");
CREATE INDEX "Folder_workspaceId_parentId_position_idx" ON "Folder"("workspaceId", "parentId", "position");
CREATE INDEX "Workbook_workspaceId_folderId_position_idx" ON "Workbook"("workspaceId", "folderId", "position");
CREATE INDEX "View_tableId_position_idx" ON "View"("tableId", "position");
CREATE UNIQUE INDEX "Tag_workspaceId_name_key" ON "Tag"("workspaceId", "name");
CREATE UNIQUE INDEX "TagAssignment_tagId_folderId_key" ON "TagAssignment"("tagId", "folderId");
CREATE UNIQUE INDEX "TagAssignment_tagId_workbookId_key" ON "TagAssignment"("tagId", "workbookId");
CREATE UNIQUE INDEX "TagAssignment_tagId_tableId_key" ON "TagAssignment"("tagId", "tableId");

ALTER TABLE "Table" ADD CONSTRAINT "Table_workbookId_fkey"
  FOREIGN KEY ("workbookId") REFERENCES "Workbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Workbook" ADD CONSTRAINT "Workbook_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Workbook" ADD CONSTRAINT "Workbook_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "View" ADD CONSTRAINT "View_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TagAssignment" ADD CONSTRAINT "TagAssignment_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TagAssignment" ADD CONSTRAINT "TagAssignment_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TagAssignment" ADD CONSTRAINT "TagAssignment_workbookId_fkey"
  FOREIGN KEY ("workbookId") REFERENCES "Workbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TagAssignment" ADD CONSTRAINT "TagAssignment_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;
