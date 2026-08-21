// Orchestration for the SEC EDGAR settlements pipeline. Candidate
// selection is keyed by DRUG BRAND NAME, not company — SEC filings are
// made at the parent-company level (e.g. Bausch Health), while this
// schema's Company rows are the NDA-holder subsidiary (e.g. Salix) with
// no parent/subsidiary relationship to bridge that gap (see
// SettlementDisclosure's doc comment). Searching EDGAR by brand name
// directly sidesteps needing that resolution at all — confirmed this
// works against a real case in scripts/poc-edgar-settlement.ts.

import { prisma } from "@/lib/prisma";
import { loadSettlementsForBrand } from "./load";
import { normalizeCompanyName, type CompanyRef } from "../litigation/match";
import type { RowIssue } from "./types";
import { isCancelRequested } from "../cancellation";

export const SETTLEMENTS_SOURCE_NAME = "SEC EDGAR full-text search (10-K/10-Q settlement disclosures)";
const EDGAR_INFO_URL = "https://www.sec.gov/edgar/search/";

const DEFAULT_BATCH_SIZE = 15;
const STALENESS_WINDOW_DAYS = 90;
const EXAMPLES_PER_CATEGORY = 3;
const MAX_CATEGORIES = 20;

export interface SettlementsRunOptions {
  limit?: number;
  brandNames?: string[]; // override for testing/targeted re-checks, mirrors LitigationRunOptions.companyIds
}

export interface SettlementsRunSummary {
  runId: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "CANCELLED";
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  brandsChecked: number;
  filingsScanned: number;
  settlementsExtracted: number;
  drugLinksCreated: number;
  totalIssues: number;
  issueCategories: { reason: string; count: number; examples: RowIssue[] }[];
  cancelled: boolean;
}

// Same grouping approach as litigation/index.ts's categorizeIssues.
function categorizeIssues(issues: RowIssue[]): SettlementsRunSummary["issueCategories"] {
  const byCategory = new Map<string, RowIssue[]>();
  for (const issue of issues) {
    const category = issue.reason.replace(/"[^"]*"/g, '"…"');
    const bucket = byCategory.get(category) ?? [];
    bucket.push(issue);
    byCategory.set(category, bucket);
  }
  return [...byCategory.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_CATEGORIES)
    .map(([reason, examples]) => ({ reason, count: examples.length, examples: examples.slice(0, EXAMPLES_PER_CATEGORY) }));
}

interface BrandCandidate {
  brandName: string;
  drugIds: string[];
}

// Only NDA (brand/innovator) holders — an ANDA generic filer has no
// patent litigation of its own to settle in this shape, and BLA/Purple
// Book biologics aren't in scope for this pass (Settlement Disclosure
// only links to Drug, not BiologicProduct — see schema.prisma). Grouped
// by brand name since one NDA commonly spans several Drug rows
// (strengths/products); one EDGAR search per brand, not per row.
async function selectCandidateBrands(opts: SettlementsRunOptions): Promise<BrandCandidate[]> {
  if (opts.brandNames?.length) {
    // Case-insensitive — Orange Book brand names are stored upper-case
    // (e.g. "XIFAXAN"), but a human targeting a specific drug via
    // --brand/brandNames shouldn't have to know or match that exactly.
    const rows = await prisma.drug.findMany({
      where: { OR: opts.brandNames.map((b) => ({ brandName: { equals: b, mode: "insensitive" as const } })) },
      select: { brandName: true, id: true },
    });
    return groupByBrand(rows);
  }

  const staleBefore = new Date(Date.now() - STALENESS_WINDOW_DAYS * 86_400_000);
  const rows = await prisma.drug.findMany({
    where: {
      applicationType: "NDA",
      OR: [{ settlementsLastCheckedAt: null }, { settlementsLastCheckedAt: { lt: staleBefore } }],
    },
    orderBy: [{ settlementsLastCheckedAt: { sort: "asc", nulls: "first" } }],
    select: { brandName: true, id: true },
  });

  // Batch-size limit applies to distinct BRANDS, not raw Drug rows — take
  // more rows than the limit up front, then cap after grouping.
  const grouped = groupByBrand(rows);
  return grouped.slice(0, opts.limit ?? DEFAULT_BATCH_SIZE);
}

function groupByBrand(rows: { brandName: string; id: string }[]): BrandCandidate[] {
  const byBrand = new Map<string, string[]>();
  for (const r of rows) byBrand.set(r.brandName, [...(byBrand.get(r.brandName) ?? []), r.id]);
  return [...byBrand.entries()].map(([brandName, drugIds]) => ({ brandName, drugIds }));
}

export async function runSettlementsIngestion(opts: SettlementsRunOptions = {}): Promise<SettlementsRunSummary> {
  const source = await prisma.dataSource.upsert({
    where: { name: SETTLEMENTS_SOURCE_NAME },
    update: { url: EDGAR_INFO_URL },
    create: { name: SETTLEMENTS_SOURCE_NAME, url: EDGAR_INFO_URL },
  });
  const run = await prisma.ingestionRun.create({ data: { sourceId: source.id, status: "RUNNING" } });
  const startedAt = run.startedAt;

  const candidates = await selectCandidateBrands(opts);

  // Precomputed once per run, same reasoning as litigation/index.ts —
  // reused for every counterparty-name resolution, never re-fetched.
  const allCompanies = await prisma.company.findMany({ select: { id: true, name: true } });
  const companiesByNormalizedName = new Map<string, CompanyRef[]>();
  for (const c of allCompanies) {
    const key = normalizeCompanyName(c.name);
    const bucket = companiesByNormalizedName.get(key) ?? [];
    bucket.push(c);
    companiesByNormalizedName.set(key, bucket);
  }

  const issues: RowIssue[] = [];
  const verifiedAt = new Date();
  let brandsChecked = 0;
  let filingsScanned = 0;
  let settlementsExtracted = 0;
  let drugLinksCreated = 0;
  let cancelled = false;

  // Sequential, same reasoning as pta/index.ts and litigation/index.ts —
  // also what makes the Stop button viable (checked between two real
  // awaited requests).
  for (const candidate of candidates) {
    if (await isCancelRequested(run.id)) {
      cancelled = true;
      break;
    }

    const result = await loadSettlementsForBrand(candidate.brandName, candidate.drugIds, companiesByNormalizedName, {
      sourceId: source.id,
      verifiedAt,
      issues,
    });
    filingsScanned += result.filingsScanned;
    settlementsExtracted += result.settlementsExtracted;
    drugLinksCreated += result.drugLinksCreated;

    await prisma.drug.updateMany({ where: { id: { in: candidate.drugIds } }, data: { settlementsLastCheckedAt: new Date() } });
    brandsChecked++;
  }

  const finishedAt = new Date();
  const status: SettlementsRunSummary["status"] = cancelled ? "CANCELLED" : issues.length === 0 ? "SUCCESS" : "PARTIAL";

  await prisma.ingestionRun.update({
    where: { id: run.id },
    data: {
      status,
      finishedAt,
      // Reusing the generic counters, same convention litigation/pta/
      // paragraphIV already established for non-FDA pipelines.
      drugsUpserted: settlementsExtracted,
      patentsUpserted: filingsScanned,
      exclusivitiesUpserted: drugLinksCreated,
      rowsSkipped: issues.length,
      summary: JSON.parse(JSON.stringify({ brandsChecked, filingsScanned, settlementsExtracted, drugLinksCreated, cancelled })),
    },
  });

  return {
    runId: run.id,
    status,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    brandsChecked,
    filingsScanned,
    settlementsExtracted,
    drugLinksCreated,
    totalIssues: issues.length,
    issueCategories: categorizeIssues(issues),
    cancelled,
  };
}
