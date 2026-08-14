-- CreateEnum
CREATE TYPE "ApplicationType" AS ENUM ('NDA', 'ANDA', 'BLA');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Drug" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "genericName" TEXT NOT NULL,
    "applicationType" "ApplicationType" NOT NULL,
    "applicationNumber" TEXT NOT NULL,
    "productNumber" TEXT NOT NULL,
    "dosageForm" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "strength" TEXT NOT NULL,
    "approvalDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Drug_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patent" (
    "id" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "patentNumber" TEXT NOT NULL,
    "coversDrugSubstance" BOOLEAN NOT NULL DEFAULT false,
    "coversDrugProduct" BOOLEAN NOT NULL DEFAULT false,
    "useCode" TEXT,
    "filingDate" TIMESTAMP(3),
    "nominalExpiryDate" TIMESTAMP(3) NOT NULL,
    "effectiveExpiryDate" TIMESTAMP(3) NOT NULL,
    "expiryAdjustmentDays" INTEGER,
    "hasTerminalDisclaimer" BOOLEAN NOT NULL DEFAULT false,
    "submittedDate" TIMESTAMP(3),
    "delistedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exclusivity" (
    "id" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "grantedDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exclusivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRecord" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "drugId" TEXT,
    "patentId" TEXT,
    "exclusivityId" TEXT,
    "externalRef" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changeNote" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");

-- CreateIndex
CREATE INDEX "Drug_brandName_idx" ON "Drug"("brandName");

-- CreateIndex
CREATE INDEX "Drug_genericName_idx" ON "Drug"("genericName");

-- CreateIndex
CREATE INDEX "Drug_companyId_idx" ON "Drug"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Drug_applicationNumber_productNumber_key" ON "Drug"("applicationNumber", "productNumber");

-- CreateIndex
CREATE INDEX "Patent_effectiveExpiryDate_idx" ON "Patent"("effectiveExpiryDate");

-- CreateIndex
CREATE INDEX "Patent_nominalExpiryDate_idx" ON "Patent"("nominalExpiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "Patent_drugId_patentNumber_useCode_key" ON "Patent"("drugId", "patentNumber", "useCode");

-- CreateIndex
CREATE INDEX "Exclusivity_expirationDate_idx" ON "Exclusivity"("expirationDate");

-- CreateIndex
CREATE UNIQUE INDEX "Exclusivity_drugId_code_expirationDate_key" ON "Exclusivity"("drugId", "code", "expirationDate");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_name_key" ON "DataSource"("name");

-- CreateIndex
CREATE INDEX "IngestionRecord_drugId_verifiedAt_idx" ON "IngestionRecord"("drugId", "verifiedAt");

-- CreateIndex
CREATE INDEX "IngestionRecord_patentId_verifiedAt_idx" ON "IngestionRecord"("patentId", "verifiedAt");

-- CreateIndex
CREATE INDEX "IngestionRecord_exclusivityId_verifiedAt_idx" ON "IngestionRecord"("exclusivityId", "verifiedAt");

-- CreateIndex
CREATE INDEX "IngestionRecord_sourceId_verifiedAt_idx" ON "IngestionRecord"("sourceId", "verifiedAt");

-- AddForeignKey
ALTER TABLE "Drug" ADD CONSTRAINT "Drug_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patent" ADD CONSTRAINT "Patent_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exclusivity" ADD CONSTRAINT "Exclusivity_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRecord" ADD CONSTRAINT "IngestionRecord_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRecord" ADD CONSTRAINT "IngestionRecord_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRecord" ADD CONSTRAINT "IngestionRecord_patentId_fkey" FOREIGN KEY ("patentId") REFERENCES "Patent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRecord" ADD CONSTRAINT "IngestionRecord_exclusivityId_fkey" FOREIGN KEY ("exclusivityId") REFERENCES "Exclusivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ensure every IngestionRecord targets exactly one entity (Drug, Patent, or
-- Exclusivity). Prisma's schema language has no first-class check-constraint
-- support, so this is added by hand — re-add it if this migration is ever
-- regenerated from schema.prisma.
ALTER TABLE "IngestionRecord" ADD CONSTRAINT "IngestionRecord_single_target_check" CHECK (
  (CASE WHEN "drugId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "patentId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "exclusivityId" IS NOT NULL THEN 1 ELSE 0 END) = 1
);
