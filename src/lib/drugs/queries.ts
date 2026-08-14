import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { ListDrugsQuery } from "./schemas";
import type { DrugDetail, DrugSummary, GenericEntryEstimate } from "./schemas";

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
  const { q, withinDays, sort, limit, offset } = query;

  const searchPattern = q ? `%${escapeLikePattern(q)}%` : null;
  const horizonDate = withinDays != null ? new Date(Date.now() + withinDays * MS_PER_DAY) : null;
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
      AND (
        ${searchPattern}::text IS NULL
        OR d."brandName" ILIKE ${searchPattern}
        OR d."genericName" ILIKE ${searchPattern}
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
