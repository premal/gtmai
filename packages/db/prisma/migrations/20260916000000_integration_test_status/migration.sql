-- AlterTable
ALTER TABLE "Integration"
ADD COLUMN "lastTestAt" TIMESTAMP(3),
ADD COLUMN "lastTestOk" BOOLEAN,
ADD COLUMN "lastTestMessage" TEXT;
