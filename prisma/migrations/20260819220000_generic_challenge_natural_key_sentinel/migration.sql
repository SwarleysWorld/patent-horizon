-- Replaces the nullable rldNdaNumber in GenericChallenge's natural-key
-- unique constraint with a NOT NULL sentinel column (naturalKeyNda) — see
-- schema.prisma's doc comment on that field for why: Postgres treats every
-- NULL as distinct, so the original constraint silently stopped
-- deduplicating the ~5% of source rows with no RLD/NDA number at all,
-- which would have re-inserted as a new row on every re-ingestion instead
-- of upserting in place. Hand-written (not `prisma migrate dev`) because
-- GenericChallenge has zero rows in every environment this has run in so
-- far (added in the immediately-preceding migration, never yet loaded
-- with real data), so there's no backfill story needed — a NOT NULL
-- column with no default is safe to add directly.

-- DropIndex
DROP INDEX "GenericChallenge_rldNdaNumber_activeIngredient_dosageForm_s_key";

-- AlterTable
ALTER TABLE "GenericChallenge" ADD COLUMN "naturalKeyNda" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "GenericChallenge_naturalKeyNda_activeIngredient_dosageForm_key" ON "GenericChallenge"("naturalKeyNda", "activeIngredient", "dosageForm", "strength");
