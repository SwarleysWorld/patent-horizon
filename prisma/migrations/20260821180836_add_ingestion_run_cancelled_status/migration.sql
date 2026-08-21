-- NOTE: `prisma migrate dev` also generated DROP INDEX statements for
-- BiologicProduct_proprietaryName_trgm_idx, Drug_brandName_trgm_idx,
-- Exclusivity_biologicProductId_idx, and Patent_biologicProductId_idx
-- (pre-existing drift — those indexes were hand-added directly in earlier
-- migrations rather than declared via @@index in schema.prisma — see the
-- same note in 20260819214125_add_paragraph_iv_generic_challenges/migration.sql)
-- and a cosmetic RenameIndex for GenericChallenge's unique constraint that
-- has nothing to do with this migration. Both deliberately omitted here,
-- same as every migration since 20260819214125.

-- AlterEnum
ALTER TYPE "IngestionRunStatus" ADD VALUE 'CANCELLED';
