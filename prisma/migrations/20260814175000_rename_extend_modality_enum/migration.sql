-- Rename DrugModality -> Modality (now shared by Drug and the upcoming
-- BiologicProduct model) and add the new biologic-specific values.
--
-- Split into its own migration, separate from the one that actually uses
-- these new values (adding Purple Book support) — Postgres does not allow
-- a newly added enum value to be referenced (e.g. in a DEFAULT clause)
-- within the same transaction it was added in ("unsafe use of new value of
-- enum type"), and each migration file runs as one transaction.
--
-- RENAME (not drop+recreate) is deliberate: it's a zero-data-loss,
-- zero-downtime operation on the existing "Drug"."modality" column — every
-- row's current classification is preserved verbatim. Prisma's own
-- generated diff for this same schema change does a DROP COLUMN + ADD
-- COLUMN instead, which would silently wipe every drug's classification;
-- hand-written here to avoid that.
ALTER TYPE "DrugModality" RENAME TO "Modality";
ALTER TYPE "Modality" ADD VALUE 'CELL_THERAPY';
ALTER TYPE "Modality" ADD VALUE 'GENE_THERAPY';
ALTER TYPE "Modality" ADD VALUE 'VACCINE';
ALTER TYPE "Modality" ADD VALUE 'UNCLASSIFIED';
