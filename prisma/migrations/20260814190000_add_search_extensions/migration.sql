-- pg_trgm powers autocomplete (src/lib/drugs/queries.ts's `autocomplete`) —
-- trigram similarity + GIN indexes give fast prefix/substring/typo-
-- tolerant name matching directly in Postgres. Chosen over a dedicated
-- search service (Elasticsearch/Meilisearch/Algolia): combined row count
-- across both sources is ~50,000, two orders of magnitude below where a
-- separate search service's relevance/scale features would earn their
-- operational cost (a second service to deploy, monitor, keep in sync) for
-- what's fundamentally prefix/substring name lookup in an internal
-- analyst tool, not consumer full-text search. See README.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Drug_brandName_trgm_idx" ON "Drug" USING GIN ("brandName" gin_trgm_ops);
CREATE INDEX "BiologicProduct_proprietaryName_trgm_idx" ON "BiologicProduct" USING GIN ("proprietaryName" gin_trgm_ops);
