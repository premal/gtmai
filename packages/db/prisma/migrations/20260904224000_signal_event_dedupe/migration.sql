ALTER TABLE "SignalEvent" ADD COLUMN "dedupeKey" TEXT;

UPDATE "SignalEvent"
SET "dedupeKey" = 'legacy:' || "id"
WHERE "dedupeKey" IS NULL;

ALTER TABLE "SignalEvent" ALTER COLUMN "dedupeKey" SET NOT NULL;

CREATE UNIQUE INDEX "SignalEvent_definitionId_dedupeKey_key"
ON "SignalEvent"("definitionId", "dedupeKey");
