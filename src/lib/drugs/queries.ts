import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { MODALITY_LABELS, type Modality } from "@/lib/classification/modality";
import { DRUG_CLASS_LABELS } from "@/lib/classification/drugClass";
import { MANUAL_ENTRY_SOURCE_NAME } from "@/lib/ingestion/manualEntry";
import type { ListDrugsQuery } from "./schemas";
import type { BiologicDetail, DrugDetail, FilterOptions, GenericEntryEstimate, SearchResult } from "./schemas";

// Latest-record-per-entity include, used to flag a Patent/Exclusivity/
// GenericChallenge/LitigationCase as manually entered on the detail
// pages — a record's most recent IngestionRecord.source tells us whether
// the last thing that touched it was a human, not a pipeline.
const LATEST_INGESTION_RECORD_SOURCE = {
  select: { source: { select: { name: true } } },
  orderBy: { verifiedAt: "desc" as const },
  take: 1,
} as const;

function wasManuallyEntered(ingestionRecords: { source: { name: string } }[]): boolean {
  return ingestionRecords[0]?.source.name === MANUAL_ENTRY_SOURCE_NAME;
}

const MS_PER_DAY = 86_400_000;

function toDateString(d: Date): string;
function toDateString(d: Date | null): string | null;
function toDateString(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// Postgres's default LIKE/ILIKE escape character is backslash. Without
// this, a search term containing literal `%` or `_` would be treated as a
// wildcard instead of a literal character.
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// One row per patent/exclusivity, used by both getDrugById and
// getBiologicById's genericEntryEstimate.
function computeGenericEntryEstimate(
  patents: {
    id: string;
    patentNumber: string;
    useCode: string;
    effectiveExpiryDate: Date;
    delistedAt: Date | null;
    expiryAdjustmentDays: number | null;
  }[],
  exclusivities: { id: string; code: string; expirationDate: Date }[],
): GenericEntryEstimate {
  // Exclusivities are FDA-final the moment they're granted — there's no
  // USPTO-style adjustment process for them, so a controlling exclusivity
  // is always "confirmed". A controlling patent is "confirmed" only once
  // its expiryAdjustmentDays has actually been checked against USPTO
  // records (see src/lib/ingestion/pta/) — until then its effectiveExpiryDate
  // is just Orange/Purple Book's own listed figure and could still shift.
  let best: { date: Date; type: "patent" | "exclusivity"; id: string; label: string; confirmed: boolean } | null = null;

  for (const p of patents) {
    if (p.delistedAt) continue; // no longer a live barrier
    if (!best || p.effectiveExpiryDate > best.date) {
      best = {
        date: p.effectiveExpiryDate,
        type: "patent",
        id: p.id,
        label: `Patent ${p.patentNumber}${p.useCode ? ` (use code ${p.useCode})` : ""}`,
        confirmed: p.expiryAdjustmentDays !== null,
      };
    }
  }

  for (const e of exclusivities) {
    if (!best || e.expirationDate > best.date) {
      best = { date: e.expirationDate, type: "exclusivity", id: e.id, label: `Exclusivity ${e.code}`, confirmed: true };
    }
  }

  if (!best) {
    return {
      date: null,
      controllingType: null,
      controllingId: null,
      controllingLabel: null,
      dateConfidence: null,
      basis: "No patents or exclusivities are currently listed — no known barrier to generic entry.",
    };
  }

  return {
    date: toDateString(best.date),
    controllingType: best.type,
    controllingId: best.id,
    controllingLabel: best.label,
    dateConfidence: best.confirmed ? "confirmed" : "pending_verification",
    basis: best.confirmed
      ? `The latest-expiring ${best.type} (${best.label}) determines this estimate — everything else listed expires on or before ${toDateString(best.date)}.`
      : `The latest-expiring ${best.type} (${best.label}) determines this estimate, but its expiry has not yet been checked against USPTO Patent Term Adjustment records — this date is still ${
          best.type === "patent" ? "the source's own listed figure" : "unverified"
        } and could move once verified. Everything else listed expires on or before ${toDateString(best.date)}.`,
  };
}

// ---- Unified list/search (GET /api/drugs) ------------------------------
//
// Spans both Drug (Orange Book) and BiologicProduct (Purple Book) in one
// query — a single `combined` CTE UNION ALLs a per-source sub-select (each
// computing the same estimated-entry-date / patent-count / exclusivity-
// count / max-PTA-gap aggregation Orange Book's query always has, just
// against BiologicProduct's own patents/exclusivities on the Purple Book
// side), then the SAME filter/sort/paginate logic applies uniformly
// regardless of which table a result came from. Building it any other way
// — two separate queries merged and re-sorted in JS — wouldn't paginate or
// sort correctly across a combined result set.
//
// Filter conditions are built as an ordered map of named Prisma.Sql
// fragments (not one flat template) specifically so getFacetCounts below
// can reuse every condition except the one belonging to the facet it's
// currently computing — the same filter-building logic powers both the
// main query and every facet query, so they can never drift apart.

// Two-level CTE: combined_raw computes the raw aggregates per product
// (including max_patent_date split into "any" vs "USPTO-confirmed only"),
// then combined derives estimated_generic_entry_date and date_confidence
// from those — a CASE expression can't reference a sibling aggregate
// computed in the same SELECT, so the derivation has to be a separate
// level rather than inlined into combined_raw directly.
const COMBINED_CTE = Prisma.sql`
  combined_raw AS (
    SELECT
      d.id,
      'orange_book'::text AS source,
      d."brandName" AS name,
      d."genericName" AS "alternateName",
      d."applicationType" AS "applicationType",
      NULL::"LicenseType" AS "licenseType",
      d."dosageForm",
      d.route,
      d.strength,
      d."approvalDate",
      d.modality,
      d."drugClass",
      c.id AS "companyId",
      c.name AS "companyName",
      MAX(p."effectiveExpiryDate") FILTER (WHERE p."delistedAt" IS NULL) AS max_patent_date,
      MAX(p."effectiveExpiryDate") FILTER (WHERE p."delistedAt" IS NULL AND p."expiryAdjustmentDays" IS NOT NULL) AS max_patent_date_confirmed,
      MAX(e."expirationDate") AS max_exclusivity_date,
      COUNT(DISTINCT p.id) AS patent_count,
      COUNT(DISTINCT e.id) AS exclusivity_count,
      MAX(p."expiryAdjustmentDays") FILTER (WHERE p."delistedAt" IS NULL) AS max_pta_gap_days,
      -- Correlated EXISTS rather than a third LEFT JOIN fanned out
      -- alongside Patent/Exclusivity — a boolean presence check doesn't
      -- need join-and-aggregate, and this avoids adding yet another
      -- multiplying join to the cross product the existing COUNT(DISTINCT)
      -- calls already have to account for.
      EXISTS (SELECT 1 FROM "GenericChallengeDrug" gcd WHERE gcd."drugId" = d.id) AS has_generic_challenge,
      EXISTS (SELECT 1 FROM "LitigationCaseDrug" lcd WHERE lcd."drugId" = d.id) AS has_litigation
    FROM "Drug" d
    JOIN "Company" c ON c.id = d."companyId"
    LEFT JOIN "Patent" p ON p."drugId" = d.id
    LEFT JOIN "Exclusivity" e ON e."drugId" = d.id
    GROUP BY d.id, c.id, c.name

    UNION ALL

    SELECT
      bp.id,
      'purple_book'::text AS source,
      bp."proprietaryName" AS name,
      bp."properName" AS "alternateName",
      NULL::"ApplicationType" AS "applicationType",
      bp."licenseType" AS "licenseType",
      bp."dosageForm",
      bp.route,
      bp.strength,
      bp."approvalDate",
      bp.modality,
      bp."drugClass",
      c.id AS "companyId",
      c.name AS "companyName",
      MAX(p."effectiveExpiryDate") FILTER (WHERE p."delistedAt" IS NULL) AS max_patent_date,
      MAX(p."effectiveExpiryDate") FILTER (WHERE p."delistedAt" IS NULL AND p."expiryAdjustmentDays" IS NOT NULL) AS max_patent_date_confirmed,
      MAX(e."expirationDate") AS max_exclusivity_date,
      COUNT(DISTINCT p.id) AS patent_count,
      COUNT(DISTINCT e.id) AS exclusivity_count,
      MAX(p."expiryAdjustmentDays") FILTER (WHERE p."delistedAt" IS NULL) AS max_pta_gap_days,
      -- Paragraph IV / GenericChallenge and federal Hatch-Waxman litigation
      -- are both deliberately Drug-only — see README. Biosimilars use the
      -- separate BPCIA patent-dance process, already tracked via Purple
      -- Book's own patent list.
      FALSE AS has_generic_challenge,
      FALSE AS has_litigation
    FROM "BiologicProduct" bp
    JOIN "Company" c ON c.id = bp."companyId"
    LEFT JOIN "Patent" p ON p."biologicProductId" = bp.id
    LEFT JOIN "Exclusivity" e ON e."biologicProductId" = bp.id
    GROUP BY bp.id, c.id, c.name
  ),
  combined AS (
    SELECT
      id, source, name, "alternateName", "applicationType", "licenseType",
      "dosageForm", route, strength, "approvalDate", modality, "drugClass",
      "companyId", "companyName",
      patent_count, exclusivity_count, max_pta_gap_days, has_generic_challenge, has_litigation,
      GREATEST(max_patent_date, max_exclusivity_date) AS estimated_generic_entry_date,
      -- confirmed: the winning date is achieved by an exclusivity (always
      -- FDA-final) or by a patent whose adjustment has actually been
      -- checked against USPTO records. Otherwise the winning date is
      -- coming from an unverified patent — still just the source's own
      -- listed figure, so pending_verification. Null only when there's no
      -- patent or exclusivity at all.
      CASE
        WHEN GREATEST(max_patent_date, max_exclusivity_date) IS NULL THEN NULL
        WHEN max_exclusivity_date IS NOT NULL AND max_exclusivity_date = GREATEST(max_patent_date, max_exclusivity_date) THEN 'confirmed'
        WHEN max_patent_date_confirmed IS NOT NULL AND max_patent_date_confirmed = GREATEST(max_patent_date, max_exclusivity_date) THEN 'confirmed'
        ELSE 'pending_verification'
      END AS date_confidence
    FROM combined_raw
  )
`;

interface FilterConditionInputs {
  searchPattern: string | null;
  horizonDate: Date | null;
  afterDate: Date | null;
  beforeDate: Date | null;
  modalityValues: string[] | null;
  drugClassValues: string[] | null;
  applicationTypeValues: string[] | null;
  dosageFormValues: string[] | null;
  routeValues: string[] | null;
  applicantValues: string[] | null;
  sourceValues: string[] | null;
  patentTypeValues: string[] | null;
  exclusivityCodeValues: string[] | null;
  minPtaGapDays: number | null;
  hasGenericChallenge: boolean;
  hasFirstCommercialMarketingDate: boolean;
  hasLitigation: boolean;
}

// EXISTS against Patent/Exclusivity, correlated by either parent FK — cuid
// ids are effectively globally unique across tables in practice, so no
// extra source-matching join is needed to avoid cross-table id collisions.
function patentTypeCondition(values: string[] | null): Prisma.Sql {
  if (!values) return Prisma.sql`TRUE`;
  const wantsSubstance = values.includes("substance");
  const wantsProduct = values.includes("product");
  const wantsUse = values.includes("use");
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "Patent" pt
    WHERE (pt."drugId" = combined.id OR pt."biologicProductId" = combined.id)
      AND pt."delistedAt" IS NULL
      AND (
        (${wantsSubstance} AND pt."coversDrugSubstance")
        OR (${wantsProduct} AND pt."coversDrugProduct")
        OR (${wantsUse} AND pt."useCode" != '')
      )
  )`;
}

function exclusivityCodeCondition(values: string[] | null): Prisma.Sql {
  if (!values) return Prisma.sql`TRUE`;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "Exclusivity" ex
    WHERE (ex."drugId" = combined.id OR ex."biologicProductId" = combined.id)
      AND ex.code = ANY(${values}::text[])
  )`;
}

// Naturally scoped to Orange Book rows only — GenericChallengeDrug only
// ever references Drug, so this EXISTS never matches a Purple Book id.
function hasFirstCommercialMarketingDateCondition(): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "GenericChallengeDrug" gcd
    JOIN "GenericChallenge" gc ON gc.id = gcd."genericChallengeId"
    WHERE gcd."drugId" = combined.id AND gc."dateOfFirstCommercialMarketing" IS NOT NULL
  )`;
}

function buildConditions(input: FilterConditionInputs): Record<string, Prisma.Sql> {
  return {
    q: input.searchPattern
      ? Prisma.sql`(name ILIKE ${input.searchPattern} OR "alternateName" ILIKE ${input.searchPattern} OR "companyName" ILIKE ${input.searchPattern})`
      : Prisma.sql`TRUE`,
    withinDays: input.horizonDate
      ? Prisma.sql`estimated_generic_entry_date <= ${input.horizonDate}::timestamp`
      : Prisma.sql`TRUE`,
    expiresAfter: input.afterDate ? Prisma.sql`estimated_generic_entry_date >= ${input.afterDate}::timestamp` : Prisma.sql`TRUE`,
    expiresBefore: input.beforeDate ? Prisma.sql`estimated_generic_entry_date <= ${input.beforeDate}::timestamp` : Prisma.sql`TRUE`,
    modality: input.modalityValues ? Prisma.sql`modality = ANY(${input.modalityValues}::"Modality"[])` : Prisma.sql`TRUE`,
    drugClass: input.drugClassValues ? Prisma.sql`"drugClass" = ANY(${input.drugClassValues}::text[])` : Prisma.sql`TRUE`,
    applicationType: input.applicationTypeValues
      ? Prisma.sql`"applicationType" = ANY(${input.applicationTypeValues}::"ApplicationType"[])`
      : Prisma.sql`TRUE`,
    dosageForm: input.dosageFormValues ? Prisma.sql`"dosageForm" = ANY(${input.dosageFormValues}::text[])` : Prisma.sql`TRUE`,
    route: input.routeValues ? Prisma.sql`route = ANY(${input.routeValues}::text[])` : Prisma.sql`TRUE`,
    applicant: input.applicantValues ? Prisma.sql`"companyName" = ANY(${input.applicantValues}::text[])` : Prisma.sql`TRUE`,
    source: input.sourceValues ? Prisma.sql`source = ANY(${input.sourceValues}::text[])` : Prisma.sql`TRUE`,
    patentType: patentTypeCondition(input.patentTypeValues),
    exclusivityCode: exclusivityCodeCondition(input.exclusivityCodeValues),
    minPtaGapDays: input.minPtaGapDays != null ? Prisma.sql`max_pta_gap_days >= ${input.minPtaGapDays}` : Prisma.sql`TRUE`,
    hasGenericChallenge: input.hasGenericChallenge ? Prisma.sql`has_generic_challenge` : Prisma.sql`TRUE`,
    hasFirstCommercialMarketingDate: input.hasFirstCommercialMarketingDate ? hasFirstCommercialMarketingDateCondition() : Prisma.sql`TRUE`,
    hasLitigation: input.hasLitigation ? Prisma.sql`has_litigation` : Prisma.sql`TRUE`,
  };
}

function whereClauseExcluding(conditions: Record<string, Prisma.Sql>, exclude: string[]): Prisma.Sql {
  const kept = Object.entries(conditions)
    .filter(([key]) => !exclude.includes(key))
    .map(([, sql]) => sql);
  return Prisma.sql`estimated_generic_entry_date IS NOT NULL AND ${Prisma.join(kept, " AND ")}`;
}

interface CombinedRow {
  id: string;
  source: "orange_book" | "purple_book";
  name: string;
  alternateName: string;
  applicationType: "NDA" | "ANDA" | "BLA" | null;
  licenseType: "STANDARD" | "BIOSIMILAR" | "INTERCHANGEABLE" | null;
  dosageForm: string;
  route: string;
  strength: string;
  approvalDate: Date | null;
  modality: Modality;
  drugClass: string | null;
  companyId: string;
  companyName: string;
  estimatedGenericEntryDate: Date | null;
  dateConfidence: "confirmed" | "pending_verification" | null;
  patentCount: bigint;
  exclusivityCount: bigint;
  maxPtaGapDays: number | null;
  hasGenericChallenge: boolean;
  hasLitigation: boolean;
  totalCount: bigint;
}

export interface ListDrugsResult {
  data: SearchResult[];
  pagination: { limit: number; offset: number; total: number; hasMore: boolean };
  facets: Record<string, { value: string; count: number }[]>;
}

function buildFilterInputs(query: ListDrugsQuery): FilterConditionInputs {
  return {
    searchPattern: query.q ? `%${escapeLikePattern(query.q)}%` : null,
    horizonDate: query.withinDays != null ? new Date(Date.now() + query.withinDays * MS_PER_DAY) : null,
    // Date-only inputs from the UI's range pickers — the lower bound is
    // midnight of that day, the upper bound is the last instant of that
    // day, so a single-day range still matches an estimate falling
    // anywhere within that calendar day.
    afterDate: query.expiresAfter ? new Date(`${query.expiresAfter}T00:00:00.000Z`) : null,
    beforeDate: query.expiresBefore ? new Date(`${query.expiresBefore}T23:59:59.999Z`) : null,
    modalityValues: query.modality ?? null,
    drugClassValues: query.drugClass ?? null,
    applicationTypeValues: query.applicationType ?? null,
    dosageFormValues: query.dosageForm ?? null,
    routeValues: query.route ?? null,
    applicantValues: query.applicant ?? null,
    sourceValues: query.source ?? null,
    patentTypeValues: query.patentType ?? null,
    exclusivityCodeValues: query.exclusivityCode ?? null,
    minPtaGapDays: query.minPtaGapDays ?? null,
    hasGenericChallenge: query.hasGenericChallenge === "true",
    hasFirstCommercialMarketingDate: query.hasFirstCommercialMarketingDate === "true",
    hasLitigation: query.hasLitigation === "true",
  };
}

// Facets are computed only for filter dimensions that are plain columns on
// `combined` (modality, source, applicationType, dosageForm, route) — not
// for the EXISTS-based patentType/exclusivityCode filters or the
// free-text/high-cardinality applicant list. This is a deliberate scope
// cut, not an oversight: those five are what an analyst actually scans
// while narrowing results, and each facet query re-materializes the full
// `combined` CTE (acceptable at this data volume, ~50K rows combined —
// revisit with a materialized view if that ever changes), so keeping the
// facet set to the dimensions that earn their cost matters more here than
// completeness for its own sake.
const FACET_DIMENSIONS: { key: string; column: Prisma.Sql }[] = [
  { key: "modality", column: Prisma.sql`modality::text` },
  { key: "source", column: Prisma.sql`source` },
  { key: "applicationType", column: Prisma.sql`"applicationType"::text` },
  { key: "dosageForm", column: Prisma.sql`"dosageForm"` },
  { key: "route", column: Prisma.sql`route` },
];

async function computeFacets(conditions: Record<string, Prisma.Sql>): Promise<Record<string, { value: string; count: number }[]>> {
  const results = await Promise.all(
    FACET_DIMENSIONS.map(async ({ key, column }) => {
      const where = whereClauseExcluding(conditions, [key]);
      const rows = await prisma.$queryRaw<{ value: string; count: bigint }[]>(Prisma.sql`
        WITH ${COMBINED_CTE}
        SELECT ${column} AS value, count(*) AS count
        FROM combined
        WHERE ${where} AND ${column} IS NOT NULL
        GROUP BY ${column}
        ORDER BY count DESC
      `);
      return [key, rows.map((r) => ({ value: r.value, count: Number(r.count) }))] as const;
    }),
  );
  return Object.fromEntries(results);
}

export async function listDrugs(query: ListDrugsQuery): Promise<ListDrugsResult> {
  const { sort, limit, offset } = query;
  const conditions = buildConditions(buildFilterInputs(query));
  const where = whereClauseExcluding(conditions, []);

  const orderBy =
    sort === "pta_gap_desc"
      ? Prisma.sql`max_pta_gap_days DESC NULLS LAST`
      : sort === "entry_desc"
        ? Prisma.sql`estimated_generic_entry_date DESC`
        : Prisma.sql`estimated_generic_entry_date ASC`;

  const [rows, facets] = await Promise.all([
    prisma.$queryRaw<CombinedRow[]>(Prisma.sql`
      WITH ${COMBINED_CTE}
      SELECT
        id, source, name, "alternateName", "applicationType", "licenseType",
        "dosageForm", route, strength, "approvalDate", modality, "drugClass",
        "companyId", "companyName",
        estimated_generic_entry_date AS "estimatedGenericEntryDate",
        date_confidence AS "dateConfidence",
        patent_count AS "patentCount",
        exclusivity_count AS "exclusivityCount",
        max_pta_gap_days AS "maxPtaGapDays",
        has_generic_challenge AS "hasGenericChallenge",
        has_litigation AS "hasLitigation",
        count(*) OVER() AS "totalCount"
      FROM combined
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `),
    computeFacets(conditions),
  ]);

  const total = rows.length > 0 ? Number(rows[0].totalCount) : 0;

  const data: SearchResult[] = rows.map((row) => ({
    id: row.id,
    source: row.source,
    name: row.name,
    alternateName: row.alternateName,
    applicationType: row.applicationType,
    licenseType: row.licenseType,
    dosageForm: row.dosageForm,
    route: row.route,
    strength: row.strength,
    approvalDate: toDateString(row.approvalDate),
    modality: row.modality,
    drugClass: row.drugClass,
    company: { id: row.companyId, name: row.companyName },
    estimatedGenericEntryDate: toDateString(row.estimatedGenericEntryDate),
    dateConfidence: row.dateConfidence,
    patentCount: Number(row.patentCount),
    exclusivityCount: Number(row.exclusivityCount),
    maxPtaGapDays: row.maxPtaGapDays,
    hasGenericChallenge: row.hasGenericChallenge,
    hasLitigation: row.hasLitigation,
  }));

  return {
    data,
    pagination: { limit, offset, total, hasMore: offset + data.length < total },
    facets,
  };
}

// ---- Autocomplete (GET /api/search/autocomplete) -----------------------
//
// pg_trgm similarity search across both sources' name columns — see
// migration 20260814190000_add_search_extensions for the extension/index
// setup and README for why Postgres trigram search was chosen over a
// dedicated search service at this data volume.
export interface AutocompleteResult {
  id: string;
  source: "orange_book" | "purple_book";
  name: string;
  alternateName: string;
}

export async function autocomplete(q: string, limit: number): Promise<AutocompleteResult[]> {
  const pattern = `%${escapeLikePattern(q)}%`;
  // Real brand/proprietary names repeat across many strength/presentation
  // rows (Humira alone is 10+ Drug/BiologicProduct rows) — DISTINCT ON
  // collapses those to one suggestion per distinct name so a dropdown
  // shows varied results instead of the same name ten times. `id` is
  // still a real, navigable row (arbitrarily the highest-scoring one for
  // that name), just not the only row that name matches.
  const rows = await prisma.$queryRaw<AutocompleteResult[]>(Prisma.sql`
    WITH matches AS (
      SELECT id, 'orange_book'::text AS source, "brandName" AS name, "genericName" AS "alternateName",
        similarity("brandName", ${q}) AS score
      FROM "Drug"
      WHERE "brandName" ILIKE ${pattern} OR "brandName" % ${q}
      UNION ALL
      SELECT id, 'purple_book'::text AS source, "proprietaryName" AS name, "properName" AS "alternateName",
        similarity("proprietaryName", ${q}) AS score
      FROM "BiologicProduct"
      WHERE "proprietaryName" ILIKE ${pattern} OR "proprietaryName" % ${q}
    ),
    deduped AS (
      SELECT DISTINCT ON (source, name) id, source, name, "alternateName", score
      FROM matches
      ORDER BY source, name, score DESC
    )
    SELECT id, source, name, "alternateName" FROM deduped
    ORDER BY score DESC, name ASC
    LIMIT ${limit}
  `);
  return rows;
}

// ---- Orange Book detail (GET /api/drugs/[id]) ---------------------------

export async function getDrugById(id: string): Promise<DrugDetail | null> {
  const drug = await prisma.drug.findUnique({
    where: { id },
    include: {
      company: true,
      patents: { orderBy: { effectiveExpiryDate: "asc" }, include: { ingestionRecords: LATEST_INGESTION_RECORD_SOURCE } },
      exclusivities: { orderBy: { expirationDate: "asc" }, include: { ingestionRecords: LATEST_INGESTION_RECORD_SOURCE } },
      challengeLinks: {
        include: { genericChallenge: { include: { ingestionRecords: LATEST_INGESTION_RECORD_SOURCE } } },
        orderBy: { genericChallenge: { submissionDate: "desc" } },
      },
      litigationLinks: {
        include: {
          litigationCase: {
            include: {
              plaintiffCompany: true,
              defendantCompany: true,
              dockets: { orderBy: { filingDate: "asc" } },
              ingestionRecords: LATEST_INGESTION_RECORD_SOURCE,
            },
          },
        },
        orderBy: { litigationCase: { earliestFilingDate: "desc" } },
      },
      settlementLinks: {
        include: { settlementDisclosure: { include: { counterpartyCompany: true } } },
        orderBy: { settlementDisclosure: { sourceFileDate: "desc" } },
      },
    },
  });

  if (!drug) return null;

  return {
    id: drug.id,
    brandName: drug.brandName,
    genericName: drug.genericName,
    applicationType: drug.applicationType,
    applicationNumber: drug.applicationNumber,
    productNumber: drug.productNumber,
    dosageForm: drug.dosageForm,
    route: drug.route,
    strength: drug.strength,
    approvalDate: toDateString(drug.approvalDate),
    modality: drug.modality,
    drugClass: drug.drugClass,
    company: { id: drug.company.id, name: drug.company.name },
    patents: drug.patents.map((p) => ({
      id: p.id,
      patentNumber: p.patentNumber,
      useCode: p.useCode,
      coversDrugSubstance: p.coversDrugSubstance,
      coversDrugProduct: p.coversDrugProduct,
      filingDate: toDateString(p.filingDate),
      nominalExpiryDate: toDateString(p.nominalExpiryDate),
      effectiveExpiryDate: toDateString(p.effectiveExpiryDate),
      expiryAdjustmentDays: p.expiryAdjustmentDays,
      submittedDate: toDateString(p.submittedDate),
      delistedAt: toDateString(p.delistedAt),
      manuallyEntered: wasManuallyEntered(p.ingestionRecords),
    })),
    exclusivities: drug.exclusivities.map((e) => ({
      id: e.id,
      code: e.code,
      description: e.description,
      grantedDate: toDateString(e.grantedDate),
      expirationDate: toDateString(e.expirationDate),
      manuallyEntered: wasManuallyEntered(e.ingestionRecords),
    })),
    genericEntryEstimate: computeGenericEntryEstimate(drug.patents, drug.exclusivities),
    genericChallenges: drug.challengeLinks.map(({ genericChallenge: gc }) => ({
      id: gc.id,
      activeIngredient: gc.activeIngredient,
      dosageForm: gc.dosageForm,
      strength: gc.strength,
      rldName: gc.rldName,
      rldNdaNumber: gc.rldNdaNumber,
      submissionDateType: gc.submissionDateType,
      submissionDate: toDateString(gc.submissionDate),
      potentialFirstApplicantAndaCount: gc.potentialFirstApplicantAndaCount,
      decisionHistory: gc.decisionHistory as unknown as DrugDetail["genericChallenges"][number]["decisionHistory"],
      currentStatus: gc.currentStatus,
      dateOfFirstApplicantApproval: toDateString(gc.dateOfFirstApplicantApproval),
      dateOfFirstCommercialMarketing: toDateString(gc.dateOfFirstCommercialMarketing),
      expirationOfLastQualifyingPatent: toDateString(gc.expirationOfLastQualifyingPatent),
      manuallyEntered: wasManuallyEntered(gc.ingestionRecords),
    })),
    litigationCases: drug.litigationLinks.map(({ litigationCase: lc }) => ({
      id: lc.id,
      plaintiffName: lc.plaintiffCompany?.name ?? lc.plaintiffNameRaw,
      plaintiffMatched: lc.plaintiffCompany != null,
      defendantName: lc.defendantCompany?.name ?? lc.defendantNameRaw,
      defendantMatched: lc.defendantCompany != null,
      earliestFilingDate: toDateString(lc.earliestFilingDate),
      outcome: lc.outcome,
      outcomeNote: lc.outcomeNote,
      matchConfidence: lc.matchConfidence,
      matchNote: lc.matchNote,
      dockets: lc.dockets.map((d) => ({
        id: d.id,
        docketNumber: d.docketNumber,
        court: d.court,
        filingDate: toDateString(d.filingDate),
        dateTerminated: toDateString(d.dateTerminated),
        judge: d.judge,
        natureOfSuit: d.natureOfSuit,
      })),
      manuallyEntered: wasManuallyEntered(lc.ingestionRecords),
    })),
    settlementDisclosures: drug.settlementLinks.map(({ settlementDisclosure: sd }) => ({
      id: sd.id,
      counterpartyNameRaw: sd.counterpartyCompany?.name ?? sd.counterpartyNameRaw,
      counterpartyMatched: sd.counterpartyCompany != null,
      filingCompanyNameRaw: sd.filingCompanyNameRaw,
      settlementAnnouncedDate: toDateString(sd.settlementAnnouncedDate),
      licensedEntryDate: toDateString(sd.licensedEntryDate),
      earlierCircumstancesNoted: sd.earlierCircumstancesNoted,
      sourceForm: sd.sourceForm,
      sourceFileDate: toDateString(sd.sourceFileDate),
      sourceFilingUrl: sd.sourceFilingUrl,
      extractedExcerpt: sd.extractedExcerpt,
      extractionConfidence: sd.extractionConfidence,
      extractionNote: sd.extractionNote,
    })),
  };
}

// ---- Purple Book detail (GET /api/biologics/[id]) -----------------------

export async function getBiologicById(id: string): Promise<BiologicDetail | null> {
  const bp = await prisma.biologicProduct.findUnique({
    where: { id },
    include: {
      company: true,
      referenceProduct: { select: { id: true, proprietaryName: true, properName: true } },
      biosimilarsAndInterchangeables: { select: { id: true, proprietaryName: true, properName: true } },
      patents: { orderBy: { effectiveExpiryDate: "asc" }, include: { ingestionRecords: LATEST_INGESTION_RECORD_SOURCE } },
      exclusivities: { orderBy: { expirationDate: "asc" }, include: { ingestionRecords: LATEST_INGESTION_RECORD_SOURCE } },
    },
  });

  if (!bp) return null;

  return {
    id: bp.id,
    proprietaryName: bp.proprietaryName,
    properName: bp.properName,
    licenseType: bp.licenseType,
    center: bp.center,
    blaNumber: bp.blaNumber,
    productNumber: bp.productNumber,
    marketingStatus: bp.marketingStatus,
    dosageForm: bp.dosageForm,
    route: bp.route,
    strength: bp.strength,
    approvalDate: toDateString(bp.approvalDate),
    modality: bp.modality,
    drugClass: bp.drugClass,
    company: { id: bp.company.id, name: bp.company.name },
    referenceProduct: bp.referenceProduct,
    referenceProductNameRaw: bp.referenceProductNameRaw,
    biosimilarsAndInterchangeables: bp.biosimilarsAndInterchangeables,
    patents: bp.patents.map((p) => ({
      id: p.id,
      patentNumber: p.patentNumber,
      useCode: p.useCode,
      coversDrugSubstance: p.coversDrugSubstance,
      coversDrugProduct: p.coversDrugProduct,
      filingDate: toDateString(p.filingDate),
      nominalExpiryDate: toDateString(p.nominalExpiryDate),
      effectiveExpiryDate: toDateString(p.effectiveExpiryDate),
      expiryAdjustmentDays: p.expiryAdjustmentDays,
      submittedDate: toDateString(p.submittedDate),
      delistedAt: toDateString(p.delistedAt),
      manuallyEntered: wasManuallyEntered(p.ingestionRecords),
    })),
    exclusivities: bp.exclusivities.map((e) => ({
      id: e.id,
      code: e.code,
      description: e.description,
      grantedDate: toDateString(e.grantedDate),
      expirationDate: toDateString(e.expirationDate),
      manuallyEntered: wasManuallyEntered(e.ingestionRecords),
    })),
    genericEntryEstimate: computeGenericEntryEstimate(bp.patents, bp.exclusivities),
  };
}

// ---- Advanced search filter vocabulary (GET /api/drugs/filter-options) --

const SOURCE_LABELS: Record<string, string> = { orange_book: "FDA Orange Book (small molecules)", purple_book: "FDA Purple Book (biologics)" };
const PATENT_TYPE_LABELS: Record<string, string> = { substance: "Drug/active substance", product: "Drug product", use: "Method of use" };

export async function getFilterOptions(): Promise<FilterOptions> {
  const [dosageFormRows, biologicDosageFormRows, routeRows, biologicRouteRows, applicantRows, biologicApplicantRows, exclusivityCodeRows] =
    await Promise.all([
      prisma.drug.findMany({ distinct: ["dosageForm"], select: { dosageForm: true } }),
      prisma.biologicProduct.findMany({ distinct: ["dosageForm"], select: { dosageForm: true } }),
      prisma.drug.findMany({ distinct: ["route"], select: { route: true } }),
      prisma.biologicProduct.findMany({ distinct: ["route"], select: { route: true } }),
      prisma.company.findMany({ where: { drugs: { some: {} } }, select: { name: true } }),
      prisma.company.findMany({ where: { biologicProducts: { some: {} } }, select: { name: true } }),
      prisma.exclusivity.findMany({ distinct: ["code"], select: { code: true } }),
    ]);

  const dosageForms = [...new Set([...dosageFormRows.map((r) => r.dosageForm), ...biologicDosageFormRows.map((r) => r.dosageForm)])].sort();
  const routes = [...new Set([...routeRows.map((r) => r.route), ...biologicRouteRows.map((r) => r.route)])].sort();
  const applicants = [...new Set([...applicantRows.map((r) => r.name), ...biologicApplicantRows.map((r) => r.name)])].sort();

  return {
    modalities: (Object.entries(MODALITY_LABELS) as [Modality, string][]).map(([value, label]) => ({ value, label })),
    drugClasses: DRUG_CLASS_LABELS,
    applicationTypes: ["NDA", "ANDA", "BLA"],
    sources: Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label })),
    patentTypes: Object.entries(PATENT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
    dosageForms,
    routes,
    applicants,
    exclusivityCodes: exclusivityCodeRows.map((r) => r.code).sort(),
  };
}

// ---- Portfolio-level counts (GET / home page) --------------------------

export interface ExpiryHorizonCounts {
  within30: number;
  within90: number;
  within365: number;
}

// Reuses COMBINED_CTE (same estimated_generic_entry_date every list/
// search result is ranked by) rather than re-deriving the estimate — a
// home-page summary number that disagreed with the list it's summarizing
// would be its own kind of trust problem.
export async function getExpiryHorizonCounts(): Promise<ExpiryHorizonCounts> {
  const now = new Date();
  const rows = await prisma.$queryRaw<{ within30: bigint; within90: bigint; within365: bigint }[]>(Prisma.sql`
    WITH ${COMBINED_CTE}
    SELECT
      count(*) FILTER (WHERE estimated_generic_entry_date <= ${new Date(now.getTime() + 30 * MS_PER_DAY)}::timestamp) AS "within30",
      count(*) FILTER (WHERE estimated_generic_entry_date <= ${new Date(now.getTime() + 90 * MS_PER_DAY)}::timestamp) AS "within90",
      count(*) FILTER (WHERE estimated_generic_entry_date <= ${new Date(now.getTime() + 365 * MS_PER_DAY)}::timestamp) AS "within365"
    FROM combined
    WHERE estimated_generic_entry_date IS NOT NULL
  `);
  const row = rows[0];
  return {
    within30: Number(row?.within30 ?? 0),
    within90: Number(row?.within90 ?? 0),
    within365: Number(row?.within365 ?? 0),
  };
}

export interface ExpiryTimelineBucket {
  /** First day of the calendar month, YYYY-MM-DD. */
  monthStart: string;
  count: number;
}

// One bucket per calendar month, current month through +11 months —
// powers the home page's timeline strip. generate_series ensures a month
// with zero expirations still appears (as 0), rather than silently
// disappearing from the strip.
export async function getExpiryTimelineBuckets(): Promise<ExpiryTimelineBucket[]> {
  const rows = await prisma.$queryRaw<{ monthStart: Date; count: bigint }[]>(Prisma.sql`
    WITH ${COMBINED_CTE},
    months AS (
      SELECT date_trunc('month', now()) + (n || ' months')::interval AS month_start
      FROM generate_series(0, 11) AS n
    )
    SELECT
      months.month_start AS "monthStart",
      count(combined.id) AS count
    FROM months
    LEFT JOIN combined
      ON date_trunc('month', combined.estimated_generic_entry_date) = months.month_start
    GROUP BY months.month_start
    ORDER BY months.month_start
  `);
  return rows.map((r) => ({ monthStart: toDateString(r.monthStart), count: Number(r.count) }));
}
