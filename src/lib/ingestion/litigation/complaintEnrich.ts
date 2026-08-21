// Orchestration for retroactively upgrading already-ingested LitigationCase
// rows from company-name-only matching to product-specific matching, by
// fetching and parsing each case's actual complaint (see complaint.ts).
// Deliberately a SEPARATE DataSource/pipeline from the search-based
// runLitigationIngestion in index.ts — same reasoning PTA enrichment is
// kept separate from Orange Book ingestion even though both touch Patent
// rows: this runs on its own schedule/trigger, against cases the search
// pipeline already created, and sharing one IngestionRun's stats between
// two conceptually different runs would make the /data page's "last run"
// card lie about which pipeline actually ran.

import { prisma } from "@/lib/prisma";
import { CourtListenerClient } from "./client";
import { extractComplaintIdentifiers } from "./complaint";
import { isCancelRequested } from "../cancellation";

export const LITIGATION_COMPLAINT_SOURCE_NAME = "CourtListener RECAP (complaint-text product matching)";
const COURTLISTENER_INFO_URL = "https://www.courtlistener.com/help/api/rest/v4/";

const DEFAULT_BATCH_SIZE = 25;
const STALENESS_WINDOW_DAYS = 90; // RECAP's archive grows as others buy documents — a "no complaint available" case today may have one later

export interface ComplaintEnrichmentRunOptions {
  limit?: number;
  caseIds?: string[]; // explicit targeting, mirrors PtaRunOptions.patentIds / LitigationRunOptions.companyIds
  drugIds?: string[]; // alternative targeting: every case currently linked to any of these Drug rows — used for the Osmoprep/Xifaxan-scoped re-test
  apiKey?: string;
}

export type CaseEnrichOutcome =
  | { kind: "matched_via_patent"; patentNumber: string; drugIds: string[] }
  | { kind: "matched_via_brand"; brandName: string; drugIds: string[] }
  | { kind: "complaint_parsed_no_match"; identifiers: { patentNumbers: string[]; brandName: string | null; andaNumber: string | null } }
  | { kind: "no_free_complaint" } // entry #1 exists in CourtListener but no attached document has plain_text
  | { kind: "not_scraped" } // CourtListener has no docket-entries at all for any of this case's dockets
  | { kind: "error"; message: string; authError?: boolean };

export interface ComplaintEnrichmentRunSummary {
  runId: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "CANCELLED";
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  casesChecked: number;
  matchedViaPatent: number;
  matchedViaBrand: number;
  complaintParsedNoMatch: number;
  noFreeComplaint: number;
  notScraped: number;
  errors: number;
  abortedOnAuthError: boolean;
  results: { caseId: string; outcome: CaseEnrichOutcome }[];
}

interface CandidateCase {
  id: string;
  dockets: { externalDocketId: number | null }[];
}

async function selectCandidateCases(opts: ComplaintEnrichmentRunOptions): Promise<CandidateCase[]> {
  const select = { id: true, dockets: { select: { externalDocketId: true }, orderBy: { filingDate: "asc" as const } } };

  if (opts.caseIds?.length) {
    return prisma.litigationCase.findMany({ where: { id: { in: opts.caseIds } }, select });
  }
  if (opts.drugIds?.length) {
    return prisma.litigationCase.findMany({
      where: { drugLinks: { some: { drugId: { in: opts.drugIds } } } },
      select,
    });
  }
  const staleBefore = new Date(Date.now() - STALENESS_WINDOW_DAYS * 86_400_000);
  return prisma.litigationCase.findMany({
    where: {
      matchConfidence: { not: "HIGH" }, // already at the top tier — nothing for this pipeline to upgrade
      OR: [{ complaintCheckedAt: null }, { complaintCheckedAt: { lt: staleBefore } }],
    },
    orderBy: [{ complaintCheckedAt: { sort: "asc", nulls: "first" } }],
    take: opts.limit ?? DEFAULT_BATCH_SIZE,
    select,
  });
}

// Every U.S. patent number in the complaint that resolves to a Patent row
// already in this DB, restricted to ones actually attached to a Drug
// (biologic-only patents can't be a Hatch-Waxman ANDA target here). Only
// resolves when every matched patent points at the SAME single Drug —
// a patent covering more than one distinct Drug (e.g. a formulation
// patent shared across several strengths under one NDA, or genuinely
// ambiguous) still fails safe into the brand-name check rather than
// guessing among them.
async function matchViaPatentNumbers(patentNumbers: string[]): Promise<{ drugIds: string[]; patentNumber: string } | null> {
  if (patentNumbers.length === 0) return null;
  const patents = await prisma.patent.findMany({
    where: { patentNumber: { in: patentNumbers }, drugId: { not: null } },
    select: { patentNumber: true, drugId: true },
  });
  if (patents.length === 0) return null;
  const distinctDrugIds = [...new Set(patents.map((p) => p.drugId as string))];
  if (distinctDrugIds.length !== 1) return null;
  return { drugIds: distinctDrugIds, patentNumber: patents[0].patentNumber };
}

function normalizeStrength(s: string): string {
  return s.replace(/\s+/g, "").toUpperCase();
}

// Falls back from patent-number matching when no patent resolved. A
// brand-name match without a parsed strength still links every Drug row
// sharing that exact brand (e.g. both Xifaxan strengths) rather than
// picking one arbitrarily — still a large, real confidence improvement
// over "any of this company's ~20 products," even when it can't narrow
// to a single row.
async function matchViaBrandName(brandName: string, strength: string | null): Promise<{ drugIds: string[]; matchedOn: string } | null> {
  const candidates = await prisma.drug.findMany({
    where: { brandName: { equals: brandName, mode: "insensitive" } },
    select: { id: true, strength: true },
  });
  if (candidates.length === 0) return null;

  if (strength) {
    const norm = normalizeStrength(strength);
    const narrowed = candidates.filter((d) => normalizeStrength(d.strength) === norm);
    if (narrowed.length > 0) {
      return { drugIds: narrowed.map((d) => d.id), matchedOn: `brand name "${brandName}", strength "${strength}"` };
    }
  }
  return { drugIds: candidates.map((d) => d.id), matchedOn: `brand name "${brandName}"` };
}

async function enrichOneCase(client: CourtListenerClient, sourceId: string, litigationCase: CandidateCase, verifiedAt: Date): Promise<CaseEnrichOutcome> {
  let plainText: string | null = null;
  let usedDocketId: number | null = null;
  let sawNotScraped = false;
  let sawNoFreeText = false;

  for (const docket of litigationCase.dockets) {
    if (docket.externalDocketId == null) continue; // manually-entered docket with no CourtListener id — nothing to fetch
    const result = await client.fetchComplaintEntry(docket.externalDocketId);

    if (result.status === "found" && result.plainText) {
      plainText = result.plainText;
      usedDocketId = docket.externalDocketId;
      break;
    }
    if (result.status === "not_scraped") sawNotScraped = true;
    else if (result.status === "no_free_text") sawNoFreeText = true;
    else if (result.status === "error") {
      if (result.authError) return { kind: "error", message: result.errorMessage ?? "auth error", authError: true };
      // A single docket's request failing isn't systemic — try the next docket in this case, if any.
    }
  }

  await prisma.litigationCase.update({ where: { id: litigationCase.id }, data: { complaintCheckedAt: verifiedAt } });

  if (!plainText) {
    return sawNoFreeText ? { kind: "no_free_complaint" } : sawNotScraped ? { kind: "not_scraped" } : { kind: "not_scraped" };
  }

  const identifiers = extractComplaintIdentifiers(plainText);
  const patentMatch = await matchViaPatentNumbers(identifiers.patentNumbers);
  const brandMatch = patentMatch ? null : identifiers.brandName ? await matchViaBrandName(identifiers.brandName, identifiers.strength) : null;
  const resolved = patentMatch ?? brandMatch;

  if (!resolved) {
    return {
      kind: "complaint_parsed_no_match",
      identifiers: { patentNumbers: identifiers.patentNumbers, brandName: identifiers.brandName, andaNumber: identifiers.andaNumber },
    };
  }

  const note = patentMatch
    ? `Product-specific match confirmed from the complaint's own text (CourtListener docket ${usedDocketId}, Document 1) — asserted Patent ${patentMatch.patentNumber} is listed against this drug. Reliability tier: same as an exact NDA/patent-number match elsewhere in this app, not the weaker company-name matching this case previously relied on.`
    : `Product-specific match confirmed from the complaint's own text (CourtListener docket ${usedDocketId}, Document 1) — the complaint explicitly names ${brandMatch!.matchedOn}. Reliability tier: same as an exact identifier match elsewhere in this app, not the weaker company-name matching this case previously relied on.`;

  // Replaces the case's existing product links rather than adding to them
  // — the pre-existing links came from company-name fan-out
  // (resolveCandidateDrugs in match.ts), which for a MEDIUM/LOW case can
  // point at many unrelated products under the same company. Now that the
  // complaint itself confirms the real product(s), leaving those stale
  // links in place would keep this case showing up as a confirmed HIGH
  // match on drug pages it was never actually about.
  await prisma.$transaction([
    prisma.litigationCaseDrug.deleteMany({ where: { litigationCaseId: litigationCase.id } }),
    prisma.litigationCaseDrug.createMany({
      data: resolved.drugIds.map((drugId) => ({ litigationCaseId: litigationCase.id, drugId })),
      skipDuplicates: true,
    }),
    prisma.litigationCase.update({ where: { id: litigationCase.id }, data: { matchConfidence: "HIGH", matchNote: note } }),
    prisma.ingestionRecord.create({
      data: { sourceId, litigationCaseId: litigationCase.id, verifiedAt, externalRef: usedDocketId ? String(usedDocketId) : null, changeNote: note },
    }),
  ]);

  return patentMatch
    ? { kind: "matched_via_patent", patentNumber: patentMatch.patentNumber, drugIds: patentMatch.drugIds }
    : { kind: "matched_via_brand", brandName: identifiers.brandName as string, drugIds: brandMatch!.drugIds };
}

export async function runComplaintEnrichment(opts: ComplaintEnrichmentRunOptions = {}): Promise<ComplaintEnrichmentRunSummary> {
  const apiKey = opts.apiKey ?? process.env.COURTLISTENER_API_KEY;
  const source = await prisma.dataSource.upsert({
    where: { name: LITIGATION_COMPLAINT_SOURCE_NAME },
    update: { url: COURTLISTENER_INFO_URL },
    create: { name: LITIGATION_COMPLAINT_SOURCE_NAME, url: COURTLISTENER_INFO_URL },
  });
  const run = await prisma.ingestionRun.create({ data: { sourceId: source.id, status: "RUNNING" } });
  const startedAt = run.startedAt;

  const emptySummary = (status: ComplaintEnrichmentRunSummary["status"], finishedAt: Date): ComplaintEnrichmentRunSummary => ({
    runId: run.id,
    status,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    casesChecked: 0,
    matchedViaPatent: 0,
    matchedViaBrand: 0,
    complaintParsedNoMatch: 0,
    noFreeComplaint: 0,
    notScraped: 0,
    errors: 0,
    abortedOnAuthError: false,
    results: [],
  });

  if (!apiKey) {
    const finishedAt = new Date();
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt, summary: { errorMessage: "COURTLISTENER_API_KEY is not set." } },
    });
    return emptySummary("FAILED", finishedAt);
  }

  const client = new CourtListenerClient(apiKey);
  const candidates = await selectCandidateCases(opts);
  const verifiedAt = new Date();

  const results: ComplaintEnrichmentRunSummary["results"] = [];
  let matchedViaPatent = 0;
  let matchedViaBrand = 0;
  let complaintParsedNoMatch = 0;
  let noFreeComplaint = 0;
  let notScraped = 0;
  let errors = 0;
  let abortedOnAuthError = false;
  let cancelled = false;

  for (const litigationCase of candidates) {
    if (await isCancelRequested(run.id)) {
      cancelled = true;
      break;
    }

    const outcome = await enrichOneCase(client, source.id, litigationCase, verifiedAt);
    results.push({ caseId: litigationCase.id, outcome });

    if (outcome.kind === "matched_via_patent") matchedViaPatent++;
    else if (outcome.kind === "matched_via_brand") matchedViaBrand++;
    else if (outcome.kind === "complaint_parsed_no_match") complaintParsedNoMatch++;
    else if (outcome.kind === "no_free_complaint") noFreeComplaint++;
    else if (outcome.kind === "not_scraped") notScraped++;
    else {
      errors++;
      if (outcome.authError) {
        abortedOnAuthError = true;
        break;
      }
    }
  }

  const finishedAt = new Date();
  const status: ComplaintEnrichmentRunSummary["status"] = cancelled
    ? "CANCELLED"
    : abortedOnAuthError
      ? "FAILED"
      : errors === 0
        ? "SUCCESS"
        : matchedViaPatent + matchedViaBrand + complaintParsedNoMatch + noFreeComplaint + notScraped > 0
          ? "PARTIAL"
          : "FAILED";

  await prisma.ingestionRun.update({
    where: { id: run.id },
    data: {
      status,
      finishedAt,
      drugsUpserted: matchedViaPatent + matchedViaBrand,
      patentsUpserted: matchedViaPatent,
      exclusivitiesUpserted: matchedViaBrand,
      rowsSkipped: complaintParsedNoMatch + noFreeComplaint + notScraped + errors,
      summary: JSON.parse(
        JSON.stringify({
          casesChecked: results.length,
          matchedViaPatent,
          matchedViaBrand,
          complaintParsedNoMatch,
          noFreeComplaint,
          notScraped,
          errors,
          abortedOnAuthError,
          cancelled,
        }),
      ),
    },
  });

  return {
    runId: run.id,
    status,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    casesChecked: results.length,
    matchedViaPatent,
    matchedViaBrand,
    complaintParsedNoMatch,
    noFreeComplaint,
    notScraped,
    errors,
    abortedOnAuthError,
    results,
  };
}
