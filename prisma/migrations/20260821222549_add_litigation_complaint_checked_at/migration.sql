-- NOTE: `prisma migrate dev --create-only` also generated DROP INDEX
-- statements here for BiologicProduct_proprietaryName_trgm_idx,
-- Drug_brandName_trgm_idx, Exclusivity_biologicProductId_idx, and
-- Patent_biologicProductId_idx — same pre-existing schema.prisma/
-- migration-history drift already documented in
-- 20260819214125_add_paragraph_iv_generic_challenges/migration.sql and
-- 20260821215002_add_settlement_disclosures/migration.sql. Deliberately
-- removed again here for the same reason.

-- AlterTable
ALTER TABLE "LitigationCase" ADD COLUMN     "complaintCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LitigationCase_complaintCheckedAt_idx" ON "LitigationCase"("complaintCheckedAt");
