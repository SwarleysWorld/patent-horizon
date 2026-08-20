-- NOTE: `prisma migrate dev --create-only` also generated DROP INDEX
-- statements for BiologicProduct_proprietaryName_trgm_idx,
-- Drug_brandName_trgm_idx, Exclusivity_biologicProductId_idx, and
-- Patent_biologicProductId_idx (pre-existing drift — those indexes were
-- hand-added directly in earlier migrations rather than declared via
-- @@index in schema.prisma — see the same note in
-- 20260819214125_add_paragraph_iv_generic_challenges/migration.sql) and a
-- cosmetic RenameIndex for GenericChallenge's unique constraint that has
-- nothing to do with this migration. Both deliberately omitted here.

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "drugId" TEXT,
    "biologicProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WatchlistItem_userId_idx" ON "WatchlistItem"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_userId_drugId_key" ON "WatchlistItem"("userId", "drugId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_userId_biologicProductId_key" ON "WatchlistItem"("userId", "biologicProductId");

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_biologicProductId_fkey" FOREIGN KEY ("biologicProductId") REFERENCES "BiologicProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly-one-parent CHECK constraint (hand-written — same pattern as
-- Patent/Exclusivity/IngestionRecord/GenericChallengeDrug elsewhere in
-- this schema; Prisma's schema language has no first-class support for
-- this).
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_single_parent_check" CHECK (
  (CASE WHEN "drugId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "biologicProductId" IS NOT NULL THEN 1 ELSE 0 END) = 1
);
