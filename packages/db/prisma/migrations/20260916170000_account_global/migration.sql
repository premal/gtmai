-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "country" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Account_country_idx" ON "Account"("country");
