-- CreateEnum
CREATE TYPE "PivSubmissionDateType" AS ENUM ('EXACT_DATE', 'PRE_MMA', 'RECEIVED_PRIOR_TO');

-- CreateEnum
CREATE TYPE "PivDecisionStatus" AS ENUM ('ELIGIBLE', 'DEFERRED', 'NON_FORFEITURE', 'EXTINGUISHED');

-- NOTE: `prisma migrate dev --create-only` also generated DROP INDEX
-- statements here for BiologicProduct_proprietaryName_trgm_idx,
-- Drug_brandName_trgm_idx, Exclusivity_biologicProductId_idx, and
-- Patent_biologicProductId_idx — pre-existing indexes that were hand-added
-- directly in earlier migrations (20260814180000_add_purple_book_biologics,
-- 20260814190000_add_search_extensions) rather than declared via @@index
-- in schema.prisma, so Prisma's diff sees them as drift and wants them
-- gone. Deliberately removed from this migration: dropping them would
-- silently regress autocomplete's trigram search and biologicProductId
-- query performance, which has nothing to do with this migration's actual
-- purpose. The schema.prisma/migration-history drift itself is
-- pre-existing and out of scope here.

-- AlterTable
ALTER TABLE "IngestionRecord" ADD COLUMN     "genericChallengeId" TEXT;

-- CreateTable
CREATE TABLE "GenericChallenge" (
    "id" TEXT NOT NULL,
    "activeIngredient" TEXT NOT NULL,
    "dosageForm" TEXT NOT NULL,
    "strength" TEXT NOT NULL,
    "rldName" TEXT NOT NULL,
    "rldNdaNumber" TEXT,
    "rldNdaNumberRaw" TEXT,
    "submissionDateType" "PivSubmissionDateType" NOT NULL,
    "submissionDate" TIMESTAMP(3),
    "potentialFirstApplicantAndaCount" INTEGER,
    "decisionHistory" JSONB NOT NULL,
    "currentStatus" "PivDecisionStatus",
    "dateOfFirstApplicantApproval" TIMESTAMP(3),
    "dateOfFirstCommercialMarketing" TIMESTAMP(3),
    "expirationOfLastQualifyingPatent" TIMESTAMP(3),
    "rawStrengthText" TEXT NOT NULL,
    "rawNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenericChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenericChallengeDrug" (
    "id" TEXT NOT NULL,
    "genericChallengeId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenericChallengeDrug_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenericChallenge_rldNdaNumber_idx" ON "GenericChallenge"("rldNdaNumber");

-- CreateIndex
CREATE INDEX "GenericChallenge_currentStatus_idx" ON "GenericChallenge"("currentStatus");

-- CreateIndex
CREATE INDEX "GenericChallenge_dateOfFirstCommercialMarketing_idx" ON "GenericChallenge"("dateOfFirstCommercialMarketing");

-- CreateIndex
CREATE UNIQUE INDEX "GenericChallenge_rldNdaNumber_activeIngredient_dosageForm_s_key" ON "GenericChallenge"("rldNdaNumber", "activeIngredient", "dosageForm", "strength");

-- CreateIndex
CREATE INDEX "GenericChallengeDrug_drugId_idx" ON "GenericChallengeDrug"("drugId");

-- CreateIndex
CREATE UNIQUE INDEX "GenericChallengeDrug_genericChallengeId_drugId_key" ON "GenericChallengeDrug"("genericChallengeId", "drugId");

-- CreateIndex
CREATE INDEX "IngestionRecord_genericChallengeId_verifiedAt_idx" ON "IngestionRecord"("genericChallengeId", "verifiedAt");

-- AddForeignKey
ALTER TABLE "GenericChallengeDrug" ADD CONSTRAINT "GenericChallengeDrug_genericChallengeId_fkey" FOREIGN KEY ("genericChallengeId") REFERENCES "GenericChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenericChallengeDrug" ADD CONSTRAINT "GenericChallengeDrug_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRecord" ADD CONSTRAINT "IngestionRecord_genericChallengeId_fkey" FOREIGN KEY ("genericChallengeId") REFERENCES "GenericChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Extend IngestionRecord's exactly-one-parent CHECK constraint to 5-way
-- (hand-written — see schema.prisma comment on IngestionRecord). Same
-- pattern as the 3-way -> 4-way extension in
-- 20260814180000_add_purple_book_biologics.
ALTER TABLE "IngestionRecord" DROP CONSTRAINT "IngestionRecord_single_target_check";
ALTER TABLE "IngestionRecord" ADD CONSTRAINT "IngestionRecord_single_target_check" CHECK (
  (CASE WHEN "drugId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "patentId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "exclusivityId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "biologicProductId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "genericChallengeId" IS NOT NULL THEN 1 ELSE 0 END) = 1
);
