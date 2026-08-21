-- NOTE: `prisma migrate dev --create-only` also generated DROP INDEX
-- statements for BiologicProduct_proprietaryName_trgm_idx,
-- Drug_brandName_trgm_idx, Exclusivity_biologicProductId_idx, and
-- Patent_biologicProductId_idx (pre-existing drift — those indexes were
-- hand-added directly in earlier migrations rather than declared via
-- @@index in schema.prisma — see the same note in
-- 20260819214125_add_paragraph_iv_generic_challenges/migration.sql) and a
-- cosmetic RenameIndex for GenericChallenge's unique constraint that has
-- nothing to do with this migration. Both deliberately omitted here.

-- CreateEnum
CREATE TYPE "LitigationCourt" AS ENUM ('DE', 'NJ');

-- CreateEnum
CREATE TYPE "LitigationOutcome" AS ENUM ('ONGOING', 'SETTLED', 'DISMISSED', 'RULING_FOR_PLAINTIFF', 'RULING_FOR_DEFENDANT', 'TRANSFERRED', 'UNCLEAR');

-- CreateEnum
CREATE TYPE "LitigationMatchConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "litigationLastCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "IngestionRecord" ADD COLUMN     "litigationCaseId" TEXT;

-- CreateTable
CREATE TABLE "LitigationCase" (
    "id" TEXT NOT NULL,
    "plaintiffCompanyId" TEXT,
    "plaintiffNameRaw" TEXT NOT NULL,
    "defendantCompanyId" TEXT,
    "defendantNameRaw" TEXT NOT NULL,
    "earliestFilingDate" TIMESTAMP(3),
    "outcome" "LitigationOutcome" NOT NULL DEFAULT 'ONGOING',
    "outcomeNote" TEXT,
    "matchConfidence" "LitigationMatchConfidence" NOT NULL,
    "matchNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LitigationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LitigationDocket" (
    "id" TEXT NOT NULL,
    "litigationCaseId" TEXT NOT NULL,
    "externalDocketId" INTEGER NOT NULL,
    "docketNumber" TEXT NOT NULL,
    "court" "LitigationCourt" NOT NULL,
    "courtRaw" TEXT NOT NULL,
    "filingDate" TIMESTAMP(3),
    "dateTerminated" TIMESTAMP(3),
    "judge" TEXT,
    "natureOfSuit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LitigationDocket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LitigationCaseDrug" (
    "id" TEXT NOT NULL,
    "litigationCaseId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LitigationCaseDrug_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LitigationCase_plaintiffCompanyId_idx" ON "LitigationCase"("plaintiffCompanyId");

-- CreateIndex
CREATE INDEX "LitigationCase_defendantCompanyId_idx" ON "LitigationCase"("defendantCompanyId");

-- CreateIndex
CREATE INDEX "LitigationCase_outcome_idx" ON "LitigationCase"("outcome");

-- CreateIndex
CREATE UNIQUE INDEX "LitigationDocket_externalDocketId_key" ON "LitigationDocket"("externalDocketId");

-- CreateIndex
CREATE INDEX "LitigationDocket_litigationCaseId_idx" ON "LitigationDocket"("litigationCaseId");

-- CreateIndex
CREATE INDEX "LitigationDocket_court_idx" ON "LitigationDocket"("court");

-- CreateIndex
CREATE INDEX "LitigationCaseDrug_drugId_idx" ON "LitigationCaseDrug"("drugId");

-- CreateIndex
CREATE UNIQUE INDEX "LitigationCaseDrug_litigationCaseId_drugId_key" ON "LitigationCaseDrug"("litigationCaseId", "drugId");

-- CreateIndex
CREATE INDEX "Company_litigationLastCheckedAt_idx" ON "Company"("litigationLastCheckedAt");

-- CreateIndex
CREATE INDEX "IngestionRecord_litigationCaseId_verifiedAt_idx" ON "IngestionRecord"("litigationCaseId", "verifiedAt");

-- AddForeignKey
ALTER TABLE "LitigationCase" ADD CONSTRAINT "LitigationCase_plaintiffCompanyId_fkey" FOREIGN KEY ("plaintiffCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LitigationCase" ADD CONSTRAINT "LitigationCase_defendantCompanyId_fkey" FOREIGN KEY ("defendantCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LitigationDocket" ADD CONSTRAINT "LitigationDocket_litigationCaseId_fkey" FOREIGN KEY ("litigationCaseId") REFERENCES "LitigationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LitigationCaseDrug" ADD CONSTRAINT "LitigationCaseDrug_litigationCaseId_fkey" FOREIGN KEY ("litigationCaseId") REFERENCES "LitigationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LitigationCaseDrug" ADD CONSTRAINT "LitigationCaseDrug_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRecord" ADD CONSTRAINT "IngestionRecord_litigationCaseId_fkey" FOREIGN KEY ("litigationCaseId") REFERENCES "LitigationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly-one-parent CHECK constraint on IngestionRecord, extended to a
-- 6th target (litigationCaseId) — same pattern used twice already (for
-- BiologicProduct, then GenericChallenge). Prisma has no first-class
-- CHECK-constraint support, so this is dropped and re-added by hand.
ALTER TABLE "IngestionRecord" DROP CONSTRAINT "IngestionRecord_single_target_check";
ALTER TABLE "IngestionRecord" ADD CONSTRAINT "IngestionRecord_single_target_check" CHECK (
  (CASE WHEN "drugId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "patentId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "exclusivityId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "biologicProductId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "genericChallengeId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "litigationCaseId" IS NOT NULL THEN 1 ELSE 0 END) = 1
);
