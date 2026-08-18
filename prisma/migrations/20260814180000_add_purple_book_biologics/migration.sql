-- Add FDA Purple Book (biologics) support: BiologicProduct model, and
-- extend Patent/Exclusivity/IngestionRecord to be polymorphic across Drug
-- and BiologicProduct. Depends on the enum rename/extension in the
-- previous migration (20260814175000_rename_extend_modality_enum).

-- CreateEnum
CREATE TYPE "LicenseType" AS ENUM ('STANDARD', 'BIOSIMILAR', 'INTERCHANGEABLE');

-- CreateEnum
CREATE TYPE "BiologicCenter" AS ENUM ('CDER', 'CBER');

-- AlterTable: Patent and Exclusivity become polymorphic (Drug OR BiologicProduct)
ALTER TABLE "Patent" ADD COLUMN "biologicProductId" TEXT,
ALTER COLUMN "drugId" DROP NOT NULL;

ALTER TABLE "Exclusivity" ADD COLUMN "biologicProductId" TEXT,
ALTER COLUMN "drugId" DROP NOT NULL;

-- AlterTable: IngestionRecord gains a fourth polymorphic target
ALTER TABLE "IngestionRecord" ADD COLUMN "biologicProductId" TEXT;

-- CreateTable
CREATE TABLE "BiologicProduct" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "blaNumber" TEXT NOT NULL,
    "productNumber" TEXT NOT NULL,
    "proprietaryName" TEXT NOT NULL,
    "properName" TEXT NOT NULL,
    "licenseType" "LicenseType" NOT NULL,
    "center" "BiologicCenter" NOT NULL,
    "dosageForm" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "strength" TEXT NOT NULL,
    "marketingStatus" TEXT,
    "approvalDate" TIMESTAMP(3),
    "referenceProductId" TEXT,
    "referenceProductNameRaw" TEXT,
    "modality" "Modality" NOT NULL DEFAULT 'UNCLASSIFIED',
    "drugClass" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BiologicProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BiologicProduct_proprietaryName_idx" ON "BiologicProduct"("proprietaryName");
CREATE INDEX "BiologicProduct_properName_idx" ON "BiologicProduct"("properName");
CREATE INDEX "BiologicProduct_companyId_idx" ON "BiologicProduct"("companyId");
CREATE INDEX "BiologicProduct_modality_idx" ON "BiologicProduct"("modality");
CREATE INDEX "BiologicProduct_drugClass_idx" ON "BiologicProduct"("drugClass");
CREATE INDEX "BiologicProduct_licenseType_idx" ON "BiologicProduct"("licenseType");
CREATE INDEX "BiologicProduct_referenceProductId_idx" ON "BiologicProduct"("referenceProductId");
CREATE UNIQUE INDEX "BiologicProduct_blaNumber_productNumber_key" ON "BiologicProduct"("blaNumber", "productNumber");

CREATE INDEX "Patent_biologicProductId_idx" ON "Patent"("biologicProductId");
CREATE INDEX "Exclusivity_biologicProductId_idx" ON "Exclusivity"("biologicProductId");
CREATE INDEX "IngestionRecord_biologicProductId_verifiedAt_idx" ON "IngestionRecord"("biologicProductId", "verifiedAt");

-- AddForeignKey
ALTER TABLE "BiologicProduct" ADD CONSTRAINT "BiologicProduct_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BiologicProduct" ADD CONSTRAINT "BiologicProduct_referenceProductId_fkey" FOREIGN KEY ("referenceProductId") REFERENCES "BiologicProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Patent" ADD CONSTRAINT "Patent_biologicProductId_fkey" FOREIGN KEY ("biologicProductId") REFERENCES "BiologicProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Exclusivity" ADD CONSTRAINT "Exclusivity_biologicProductId_fkey" FOREIGN KEY ("biologicProductId") REFERENCES "BiologicProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IngestionRecord" ADD CONSTRAINT "IngestionRecord_biologicProductId_fkey" FOREIGN KEY ("biologicProductId") REFERENCES "BiologicProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly-one-parent CHECK constraints (hand-written — see schema.prisma
-- comments on Patent/Exclusivity/IngestionRecord for the full rationale).
-- Patent and Exclusivity didn't have one before (drugId was NOT NULL, so
-- there was nothing to enforce); now that both FKs are nullable, one is
-- needed on each. IngestionRecord's existing 3-way check is replaced with
-- a 4-way one.
ALTER TABLE "Patent" ADD CONSTRAINT "Patent_single_parent_check" CHECK (
  (CASE WHEN "drugId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "biologicProductId" IS NOT NULL THEN 1 ELSE 0 END) = 1
);

ALTER TABLE "Exclusivity" ADD CONSTRAINT "Exclusivity_single_parent_check" CHECK (
  (CASE WHEN "drugId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "biologicProductId" IS NOT NULL THEN 1 ELSE 0 END) = 1
);

ALTER TABLE "IngestionRecord" DROP CONSTRAINT "IngestionRecord_single_target_check";
ALTER TABLE "IngestionRecord" ADD CONSTRAINT "IngestionRecord_single_target_check" CHECK (
  (CASE WHEN "drugId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "patentId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "exclusivityId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "biologicProductId" IS NOT NULL THEN 1 ELSE 0 END) = 1
);

-- Partial unique indexes for the biologic side of Patent/Exclusivity.
-- Can't be a plain compound @@unique spanning both nullable FK columns:
-- Postgres treats every NULL as distinct from every other NULL, so a row
-- with drugId = NULL would never collide with another under a standard
-- unique index — it would silently enforce nothing for biologic rows. A
-- WHERE-scoped partial index sidesteps that entirely, and has no
-- first-class Prisma schema syntax, hence hand-written here (same
-- category of gap as the CHECK constraints above). The existing
-- Patent_drugId_patentNumber_useCode_key / Exclusivity_drugId_code_...
-- indexes are untouched and continue to correctly enforce uniqueness for
-- Orange Book rows, since drugId stays non-null on all of those.
CREATE UNIQUE INDEX "Patent_biologicProductId_patentNumber_key"
  ON "Patent" ("biologicProductId", "patentNumber")
  WHERE "biologicProductId" IS NOT NULL;

CREATE UNIQUE INDEX "Exclusivity_biologicProductId_code_expirationDate_key"
  ON "Exclusivity" ("biologicProductId", "code", "expirationDate")
  WHERE "biologicProductId" IS NOT NULL;
