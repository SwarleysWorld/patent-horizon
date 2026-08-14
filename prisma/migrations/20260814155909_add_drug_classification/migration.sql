-- CreateEnum
CREATE TYPE "DrugModality" AS ENUM ('SMALL_MOLECULE', 'PEPTIDE', 'OLIGONUCLEOTIDE', 'MONOCLONAL_ANTIBODY', 'OTHER');

-- AlterTable
ALTER TABLE "Drug" ADD COLUMN     "drugClass" TEXT,
ADD COLUMN     "modality" "DrugModality" NOT NULL DEFAULT 'SMALL_MOLECULE';

-- CreateIndex
CREATE INDEX "Drug_modality_idx" ON "Drug"("modality");

-- CreateIndex
CREATE INDEX "Drug_drugClass_idx" ON "Drug"("drugClass");

-- CreateIndex
CREATE INDEX "Drug_dosageForm_idx" ON "Drug"("dosageForm");
