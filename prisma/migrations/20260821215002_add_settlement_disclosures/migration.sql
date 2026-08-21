-- CreateEnum
CREATE TYPE "SettlementExtractionConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- NOTE: `prisma migrate dev --create-only` also generated DROP INDEX
-- statements here for BiologicProduct_proprietaryName_trgm_idx,
-- Drug_brandName_trgm_idx, Exclusivity_biologicProductId_idx, and
-- Patent_biologicProductId_idx — same pre-existing schema.prisma/
-- migration-history drift already documented in
-- 20260819214125_add_paragraph_iv_generic_challenges/migration.sql.
-- Deliberately removed again here for the same reason: dropping them
-- would silently regress autocomplete's trigram search and
-- biologicProductId query performance, unrelated to this migration.

-- AlterTable
ALTER TABLE "Drug" ADD COLUMN     "settlementsLastCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "IngestionRecord" ADD COLUMN     "settlementDisclosureId" TEXT;

-- CreateTable
CREATE TABLE "SettlementDisclosure" (
    "id" TEXT NOT NULL,
    "drugNameRaw" TEXT NOT NULL,
    "counterpartyNameRaw" TEXT NOT NULL,
    "counterpartyCompanyId" TEXT,
    "filingCompanyNameRaw" TEXT NOT NULL,
    "settlementAnnouncedDate" TIMESTAMP(3),
    "licensedEntryDate" TIMESTAMP(3),
    "earlierCircumstancesNoted" BOOLEAN NOT NULL DEFAULT false,
    "sourceForm" TEXT NOT NULL,
    "sourceFileDate" TIMESTAMP(3) NOT NULL,
    "sourceFilingUrl" TEXT NOT NULL,
    "extractedExcerpt" TEXT NOT NULL,
    "extractionConfidence" "SettlementExtractionConfidence" NOT NULL,
    "extractionNote" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementDisclosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementDisclosureDrug" (
    "id" TEXT NOT NULL,
    "settlementDisclosureId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementDisclosureDrug_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementDisclosure_counterpartyCompanyId_idx" ON "SettlementDisclosure"("counterpartyCompanyId");

-- CreateIndex
CREATE INDEX "SettlementDisclosure_drugNameRaw_idx" ON "SettlementDisclosure"("drugNameRaw");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementDisclosure_sourceFilingUrl_drugNameRaw_counterpar_key" ON "SettlementDisclosure"("sourceFilingUrl", "drugNameRaw", "counterpartyNameRaw");

-- CreateIndex
CREATE INDEX "SettlementDisclosureDrug_drugId_idx" ON "SettlementDisclosureDrug"("drugId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementDisclosureDrug_settlementDisclosureId_drugId_key" ON "SettlementDisclosureDrug"("settlementDisclosureId", "drugId");

-- CreateIndex
CREATE INDEX "Drug_settlementsLastCheckedAt_idx" ON "Drug"("settlementsLastCheckedAt");

-- CreateIndex
CREATE INDEX "IngestionRecord_settlementDisclosureId_verifiedAt_idx" ON "IngestionRecord"("settlementDisclosureId", "verifiedAt");

-- AddForeignKey
ALTER TABLE "SettlementDisclosure" ADD CONSTRAINT "SettlementDisclosure_counterpartyCompanyId_fkey" FOREIGN KEY ("counterpartyCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementDisclosureDrug" ADD CONSTRAINT "SettlementDisclosureDrug_settlementDisclosureId_fkey" FOREIGN KEY ("settlementDisclosureId") REFERENCES "SettlementDisclosure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementDisclosureDrug" ADD CONSTRAINT "SettlementDisclosureDrug_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRecord" ADD CONSTRAINT "IngestionRecord_settlementDisclosureId_fkey" FOREIGN KEY ("settlementDisclosureId") REFERENCES "SettlementDisclosure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "GenericChallenge_naturalKeyNda_activeIngredient_dosageForm_key" RENAME TO "GenericChallenge_naturalKeyNda_activeIngredient_dosageForm__key";

-- Exactly-one-parent CHECK constraint on IngestionRecord, extended to a
-- 7th target (settlementDisclosureId) — same pattern used for
-- BiologicProduct, GenericChallenge, and LitigationCase before it. Prisma
-- has no first-class CHECK-constraint support, so this is dropped and
-- re-added by hand.
ALTER TABLE "IngestionRecord" DROP CONSTRAINT "IngestionRecord_single_target_check";
ALTER TABLE "IngestionRecord" ADD CONSTRAINT "IngestionRecord_single_target_check" CHECK (
  (CASE WHEN "drugId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "patentId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "exclusivityId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "biologicProductId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "genericChallengeId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "litigationCaseId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "settlementDisclosureId" IS NOT NULL THEN 1 ELSE 0 END) = 1
);
