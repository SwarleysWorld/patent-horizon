import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { MODALITY_LABELS, type DrugModality } from "@/lib/classification/modality";
import { DRUG_CLASS_LABELS } from "@/lib/classification/drugClass";
import type { ListDrugsQuery } from "./schemas";
import type { DrugDetail, DrugSummary, FilterOptions, GenericEntryEstimate } from "./schemas";

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

interface DrugListRow {
  id: string;
  brandName: string;
  genericName: string;
  applicationType: "NDA" | "ANDA" | "BLA";
  applicationNumber: string;
  productNumber: string;
  dosageForm: string;
  route: string;
  strength: string;
  approvalDate: Date | null;
  modality: "SMALL_MOLECULE" | "PEPTIDE" | "OLIGONUCLEOTIDE" | "MONOCLONAL_ANTIBODY" | "OTHER";
  drugClass: string | null;
  companyId: string;
  companyName: string;
  estimatedGenericEntryDate: Date | null;
  patentCount: bigint;
  exclusivityCount: bigint;
  totalCount: bigint;
}

export interface ListDrugsResult {
  data: DrugSummary[];
  pagination: { limit: number; offset: number; total: number; hasMore: boolean };
}

// The core query behind "show me patents expiring soon": for every drug,
// compute the latest-expiring (still-listed) patent or exclusivity — that
// date is the earliest point a generic competitor could plausibly enter —
// then filter/sort/paginate on it in the database rather than pulling
// every drug's patents into JS to do it. `count(*) OVER()` gets the total
// matching row count in the same query instead of a second round trip.
export async function listDrugs(query: ListDrugsQuery): Promise<ListDrugsResult> {
  const {
    q,
    withinDays,
    expiresAfter,
    expiresBefore,
    modality,
    drugClass,
    applicationType,
    dosageForm,
    sort,
    limit,
    offset,
  } = query;

  const searchPattern = q ? `%${escapeLikePattern(q)}%` : null;
  const horizonDate = withinDays != null ? new Date(Date.now() + withinDays * MS_PER_DAY) : null;
  // Date-only inputs from the UI's range pickers — the lower bound is
  // midnight of that day, the upper bound is the last instant of that day,
  // so a single-day range (after=before=2026-01-01) still matches an
  // estimate that falls anywhere within that calendar day.
  const afterDate = expiresAfter ? new Date(`${expiresAfter}T00:00:00.000Z`) : null;
  const beforeDate = expiresBefore ? new Date(`${expiresBefore}T23:59:59.999Z`) : null;
  const modalityValue = modality ?? null;
  const drugClassValue = drugClass ?? null;
  const applicationTypeValue = applicationType ?? null;
  const dosageFormValue = dosageForm ?? null;
  const orderDirection = sort === "entry_desc" ? Prisma.raw("DESC") : Prisma.raw("ASC");

  const rows = await prisma.$queryRaw<DrugListRow[]>`
    WITH horizon AS (
      SELECT
        d.id,
        GREATEST(
          MAX(p."effectiveExpiryDate") FILTER (WHERE p."delistedAt" IS NULL),
          MAX(e."expirationDate")
        ) AS estimated_generic_entry_date,
        COUNT(DISTINCT p.id) AS patent_count,
        COUNT(DISTINCT e.id) AS exclusivity_count
      FROM "Drug" d
      LEFT JOIN "Patent" p ON p."drugId" = d.id
      LEFT JOIN "Exclusivity" e ON e."drugId" = d.id
      GROUP BY d.id
    )
    SELECT
      d.id,
      d."brandName",
      d."genericName",
      d."applicationType",
      d."applicationNumber",
      d."productNumber",
      d."dosageForm",
      d.route,
      d.strength,
      d."approvalDate",
      d.modality,
      d."drugClass",
      c.id AS "companyId",
      c.name AS "companyName",
      h.estimated_generic_entry_date AS "estimatedGenericEntryDate",
      h.patent_count AS "patentCount",
      h.exclusivity_count AS "exclusivityCount",
      count(*) OVER() AS "totalCount"
    FROM "Drug" d
    JOIN "Company" c ON c.id = d."companyId"
    JOIN horizon h ON h.id = d.id
    WHERE h.estimated_generic_entry_date IS NOT NULL
      AND (${horizonDate}::timestamp IS NULL OR h.estimated_generic_entry_date <= ${horizonDate}::timestamp)
      AND (${afterDate}::timestamp IS NULL OR h.estimated_generic_entry_date >= ${afterDate}::timestamp)
      AND (${beforeDate}::timestamp IS NULL OR h.estimated_generic_entry_date <= ${beforeDate}::timestamp)
      AND (${modalityValue}::text IS NULL OR d.modality = ${modalityValue}::"DrugModality")
      AND (${drugClassValue}::text IS NULL OR d."drugClass" = ${drugClassValue})
      AND (${applicationTypeValue}::text IS NULL OR d."applicationType" = ${applicationTypeValue}::"ApplicationType")
      AND (${dosageFormValue}::text IS NULL OR d."dosageForm" = ${dosageFormValue})
      AND (
        ${searchPattern}::text IS NULL
        OR d."brandName" ILIKE ${searchPattern}
        OR d."genericName" ILIKE ${searchPattern}
        OR c.name ILIKE ${searchPattern}
      )
    ORDER BY h.estimated_generic_entry_date ${orderDirection}
    LIMIT ${limit} OFFSET ${offset}
  `;

  const total = rows.length > 0 ? Number(rows[0].totalCount) : 0;

  const data: DrugSummary[] = rows.map((row) => ({
    id: row.id,
    brandName: row.brandName,
    genericName: row.genericName,
    applicationType: row.applicationType,
    applicationNumber: row.applicationNumber,
    productNumber: row.productNumber,
    dosageForm: row.dosageForm,
    route: row.route,
    strength: row.strength,
    approvalDate: toDateString(row.approvalDate),
    modality: row.modality,
    drugClass: row.drugClass,
    company: { id: row.companyId, name: row.companyName },
    estimatedGenericEntryDate: toDateString(row.estimatedGenericEntryDate),
    patentCount: Number(row.patentCount),
    exclusivityCount: Number(row.exclusivityCount),
  }));

  return {
    data,
    pagination: { limit, offset, total, hasMore: offset + data.length < total },
  };
}

function computeGenericEntryEstimate(
  patents: { id: string; patentNumber: string; useCode: string; effectiveExpiryDate: Date; delistedAt: Date | null }[],
  exclusivities: { id: string; code: string; expirationDate: Date }[],
): GenericEntryEstimate {
  let best: { date: Date; type: "patent" | "exclusivity"; id: string; label: string } | null = null;

  for (const p of patents) {
    if (p.delistedAt) continue; // no longer a live barrier
    if (!best || p.effectiveExpiryDate > best.date) {
      best = {
        date: p.effectiveExpiryDate,
        type: "patent",
        id: p.id,
        label: `Patent ${p.patentNumber}${p.useCode ? ` (use code ${p.useCode})` : ""}`,
      };
    }
  }

  for (const e of exclusivities) {
    if (!best || e.expirationDate > best.date) {
      best = { date: e.expirationDate, type: "exclusivity", id: e.id, label: `Exclusivity ${e.code}` };
    }
  }

  if (!best) {
    return {
      date: null,
      controllingType: null,
      controllingId: null,
      controllingLabel: null,
      basis:
        "No patents or exclusivities are currently listed for this drug — no known barrier to generic entry.",
    };
  }

  return {
    date: toDateString(best.date),
    controllingType: best.type,
    controllingId: best.id,
    controllingLabel: best.label,
    basis: `The latest-expiring ${best.type} (${best.label}) determines this estimate — every other listed patent and exclusivity for this drug expires on or before ${toDateString(best.date)}.`,
  };
}

export async function getDrugById(id: string): Promise<DrugDetail | null> {
  const drug = await prisma.drug.findUnique({
    where: { id },
    include: {
      company: true,
      patents: { orderBy: { effectiveExpiryDate: "asc" } },
      exclusivities: { orderBy: { expirationDate: "asc" } },
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
    })),
    exclusivities: drug.exclusivities.map((e) => ({
      id: e.id,
      code: e.code,
      description: e.description,
      grantedDate: toDateString(e.grantedDate),
      expirationDate: toDateString(e.expirationDate),
    })),
    genericEntryEstimate: computeGenericEntryEstimate(drug.patents, drug.exclusivities),
  };
}

// Powers the advanced search UI's filter selects. modality and
// applicationType are small fixed vocabularies (enums), so every possible
// value is offered — including ones with zero current matches, like
// MONOCLONAL_ANTIBODY and BLA (Orange Book doesn't cover biologics; see
// README) — the same way the modality classifier itself is designed to be
// ready the day that data shows up, rather than silently hiding the option.
// drugClass is likewise a fixed vocabulary we control (the classifier's own
// label set). dosageForm is genuinely open-ended free text from the source
// data (100+ distinct values), so that one is queried live rather than
// hardcoded.
export async function getFilterOptions(): Promise<FilterOptions> {
  const dosageFormRows = await prisma.drug.findMany({
    distinct: ["dosageForm"],
    select: { dosageForm: true },
    orderBy: { dosageForm: "asc" },
  });

  return {
    modalities: (Object.entries(MODALITY_LABELS) as [DrugModality, string][]).map(([value, label]) => ({
      value,
      label,
    })),
    drugClasses: DRUG_CLASS_LABELS,
    applicationTypes: ["NDA", "ANDA", "BLA"],
    dosageForms: dosageFormRows.map((r) => r.dosageForm),
  };
}
