-- Replace the hand-written PARTIAL unique indexes from the previous
-- migration with plain (non-partial) ones covering the SAME two columns.
--
-- Turns out the partial WHERE clause was unnecessary complexity: a plain
-- multi-column unique index already only enforces uniqueness among rows
-- where EVERY indexed column is non-null (Postgres skips a row from
-- uniqueness checking as soon as any one of the index's own columns is
-- NULL) — so a plain `UNIQUE (biologicProductId, patentNumber)` already
-- behaves exactly like the intended `WHERE biologicProductId IS NOT NULL`
-- partial index for Orange Book rows (biologicProductId always NULL on
-- those), with no partial-index syntax needed. The earlier reasoning about
-- NULLs defeating a compound unique index only applies when the unique
-- index spans MULTIPLE nullable columns that can independently be null on
-- the same row (e.g. a single index covering both drugId AND
-- biologicProductId together) — that's not the case here, since
-- (biologicProductId, patentNumber) doesn't reference drugId at all.
--
-- The practical reason to fix this: a plain @@unique is representable in
-- schema.prisma directly, which gives Prisma Client a real generated
-- compound-where-unique-input type and lets ingestion code use the normal
-- `upsert()` API — a partial index has no schema.prisma equivalent, so
-- Prisma Client has no way to know it exists.
DROP INDEX "Patent_biologicProductId_patentNumber_key";
CREATE UNIQUE INDEX "Patent_biologicProductId_patentNumber_key" ON "Patent" ("biologicProductId", "patentNumber");

DROP INDEX "Exclusivity_biologicProductId_code_expirationDate_key";
CREATE UNIQUE INDEX "Exclusivity_biologicProductId_code_expirationDate_key" ON "Exclusivity" ("biologicProductId", "code", "expirationDate");
