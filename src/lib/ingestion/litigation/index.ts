// Orchestration for the CourtListener litigation pipeline. Rate-limit-
// bound by construction (5 req/min, 125/day on CourtListener's free
// tier) — a full pass over every candidate company takes many runs, so
// this is deliberately NOT part of `npm run refresh:data` (same reasoning
// refresh-data.ts already gives for excluding PTA enrichment).

import { prisma } from "@/lib/prisma";
import { CourtListenerClient } from "./client";
import { loadHitsForCompany } from "./load";
import type { CompanyRef, MatchConfidenceTier } from "./match";
import { normalizeCompanyName } from "./match";
import type { RowIssue } from "./types";
import { isCancelRequested } from "../cancellation";

export const LITIGATION_SOURCE_NAME = "CourtListener RECAP (Hatch-Waxman litigation, D. Del. / D.N.J.)";
const COURTLISTENER_INFO_URL = "https://www.courtlistener.com/help/api/rest/v4/";

const DEFAULT_BATCH_SIZE = 25;
const STALENESS_WINDOW_DAYS = 90;
const EXAMPLES_PER_CATEGORY = 3;
const MAX_CATEGORIES = 20;

export interface LitigationRunOptions {
  limit?: number;
  companyIds?: string[]; // override for testing/targeted re-checks, mirrors PtaRunOptions.patentIds
  apiKey?: string; // override for testing; defaults to process.env.COURTLISTENER_API_KEY
}

export interface LitigationRunSummary {
  runId: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "CANCELLED";
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  companiesChecked: number;
  casesTouched: number;
  docketsUpserted: number;
  ingestionRecordsCreated: number;
  confidenceCounts: Record<MatchConfidenceTier, number>;
  totalIssues: number;
  issueCategories: { reason: string; count: number; examples: RowIssue[] }[];
  abortedOnAuthError: boolean;
  errorMessage?: string;
}

// Same grouping/normalization approach as the other pipelines'
// categorizeIssues — one noisy-but-benign category shouldn't crowd rarer,
// more actionable ones out of a flat top-N slice.
function categorizeIssues(issues: RowIssue[]): LitigationRunSummary["issueCategories"] {
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

async function selectCandidateCompanies(opts: LitigationRunOptions): Promise<{ id: string; name: string }[]> {
  if (opts.companyIds?.length) {
    return prisma.company.findMany({ where: { id: { in: opts.companyIds } }, select: { id: true, name: true } });
  }
  const staleBefore = new Date(Date.now() - STALENESS_WINDOW_DAYS * 86_400_000);
  return prisma.company.findMany({
    where: {
      drugs: { some: { challengeLinks: { some: {} } } }, // scoped to brand companies with an existing Paragraph IV filing — the real search scope, not all companies
      OR: [{ litigationLastCheckedAt: null }, { litigationLastCheckedAt: { lt: staleBefore } }],
    },
    orderBy: [{ litigationLastCheckedAt: { sort: "asc", nulls: "first" } }],
    take: opts.limit ?? DEFAULT_BATCH_SIZE,
    select: { id: true, name: true },
  });
}

export async function runLitigationIngestion(opts: LitigationRunOptions = {}): Promise<LitigationRunSummary> {
  const apiKey = opts.apiKey ?? process.env.COURTLISTENER_API_KEY;
  const source = await prisma.dataSource.upsert({
    where: { name: LITIGATION_SOURCE_NAME },
    update: { url: COURTLISTENER_INFO_URL },
    create: { name: LITIGATION_SOURCE_NAME, url: COURTLISTENER_INFO_URL },
  });
  const run = await prisma.ingestionRun.create({ data: { sourceId: source.id, status: "RUNNING" } });
  const startedAt = run.startedAt;

  if (!apiKey) {
    const finishedAt = new Date();
    const errorMessage = "COURTLISTENER_API_KEY is not set. See README.md \"Data ingestion: Federal Litigation Tracking\" for how to obtain a free one.";
    await prisma.ingestionRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt, summary: { errorMessage } } });
    return {
      runId: run.id,
      status: "FAILED",
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      companiesChecked: 0,
      casesTouched: 0,
      docketsUpserted: 0,
      ingestionRecordsCreated: 0,
      confidenceCounts: { HIGH: 0, MEDIUM: 0, LOW: 0 },
      totalIssues: 0,
      issueCategories: [],
      abortedOnAuthError: false,
      errorMessage,
    };
  }

  const client = new CourtListenerClient(apiKey);
  const candidates = await selectCandidateCompanies(opts);

  // Precomputed ONCE per run, reused across every company/hit — never
  // re-fetch per hit. Small enough to hold in memory (~2,300 companies).
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
  let companiesChecked = 0;
  let casesTouched = 0;
  let docketsUpserted = 0;
  let ingestionRecordsCreated = 0;
  const confidenceCounts: Record<MatchConfidenceTier, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  let abortedOnAuthError = false;
  let cancelled = false;

  // Strictly sequential — CourtListener's rate limit is a shared 5 req/min
  // budget across the whole run, not per-company. That sequencing is also
  // what makes a Stop button viable: checking the cancellation flag once
  // per company, between two real awaited (and rate-limited) requests,
  // notices a stop request within one company's worth of latency.
  for (const company of candidates) {
    if (await isCancelRequested(run.id)) {
      cancelled = true;
      break;
    }

    const result = await client.searchHatchWaxmanCases(company.name);

    if (result.status === "error") {
      if (result.authError) {
        abortedOnAuthError = true;
        issues.push({ file: "courtlistener-search", line: -1, reason: `auth error: ${result.errorMessage ?? "unknown"}`, raw: company.name });
        break;
      }
      // A request-level failure for one company isn't systemic — log it
      // and move on. Deliberately do NOT stamp litigationLastCheckedAt
      // here, leaving this company eligible for immediate retry next run.
      issues.push({ file: "courtlistener-search", line: -1, reason: `search request failed: ${result.errorMessage ?? "unknown"}`, raw: company.name });
      continue;
    }

    const loadResult = await loadHitsForCompany(result.hits, company, companiesByNormalizedName, { sourceId: source.id, verifiedAt, issues });
    casesTouched += loadResult.casesTouched;
    docketsUpserted += loadResult.docketsUpserted;
    ingestionRecordsCreated += loadResult.ingestionRecordsCreated;
    confidenceCounts.HIGH += loadResult.confidenceCounts.HIGH;
    confidenceCounts.MEDIUM += loadResult.confidenceCounts.MEDIUM;
    confidenceCounts.LOW += loadResult.confidenceCounts.LOW;

    await prisma.company.update({ where: { id: company.id }, data: { litigationLastCheckedAt: new Date() } });
    companiesChecked++;
  }

  const finishedAt = new Date();
  const status: LitigationRunSummary["status"] = cancelled
    ? "CANCELLED"
    : abortedOnAuthError
      ? "FAILED"
      : issues.length === 0
        ? "SUCCESS"
        : "PARTIAL";

  await prisma.ingestionRun.update({
    where: { id: run.id },
    data: {
      status,
      finishedAt,
      // Reusing the existing generically-named counters, same convention
      // paragraphIV/index.ts already established (its own comment: this
      // column is "the generically-named 'primary entity count' column
      // shared across pipelines"). drugsUpserted = LitigationCase count
      // (primary entity), patentsUpserted = LitigationDocket count (child
      // rows, same role Patent plays under Drug elsewhere).
      drugsUpserted: casesTouched,
      patentsUpserted: docketsUpserted,
      exclusivitiesUpserted: 0,
      rowsSkipped: issues.length,
      summary: JSON.parse(
        JSON.stringify({ companiesChecked, casesTouched, docketsUpserted, confidenceCounts, abortedOnAuthError, cancelled }),
      ),
    },
  });

  return {
    runId: run.id,
    status,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    companiesChecked,
    casesTouched,
    docketsUpserted,
    ingestionRecordsCreated,
    confidenceCounts,
    totalIssues: issues.length,
    issueCategories: categorizeIssues(issues),
    abortedOnAuthError,
    errorMessage: abortedOnAuthError ? "aborted after an auth error — check COURTLISTENER_API_KEY" : undefined,
  };
}
