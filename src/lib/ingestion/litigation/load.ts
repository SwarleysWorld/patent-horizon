// The DB-writing half of the litigation pipeline. Calls into match.ts for
// every judgment call (party matching, confidence scoring, outcome
// derivation); this file only turns those results into upserts.

import { prisma } from "@/lib/prisma";
import type { RecapSearchHit, RowIssue } from "./types";
import {
  splitCaseName,
  matchCompanyByName,
  resolveRole,
  resolveCandidateDrugs,
  scoreConfidence,
  deriveCaseOutcome,
  toLitigationCourt,
  type CompanyRef,
  type MatchConfidenceTier,
} from "./match";

export interface LoadResult {
  casesTouched: number; // distinct LitigationCase rows created or updated this run
  docketsUpserted: number;
  ingestionRecordsCreated: number;
  confidenceCounts: Record<MatchConfidenceTier, number>;
}

const GROUPING_WINDOW_DAYS = 180;
const MS_PER_DAY = 86_400_000;
const TIER_RANK: Record<MatchConfidenceTier, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / MS_PER_DAY;
}

// Groups a new hit into an existing LitigationCase when the same
// party pair (matched by resolved Company id when available, else by
// exact raw-name equality) has an existing docket within
// GROUPING_WINDOW_DAYS of this hit's filing date — otherwise creates a
// new case. Explicitly heuristic: can under- or over-group in edge cases
// (e.g. two genuinely unrelated disputes between the same two companies
// filed a few months apart would incorrectly merge) — same honesty
// register as paragraphIV/load.ts's fuzzy dosage-form matching.
async function findOrCreateLitigationCase(params: {
  plaintiffCompanyId: string | null;
  defendantCompanyId: string | null;
  plaintiffNameRaw: string;
  defendantNameRaw: string;
  filingDate: Date | null;
  confidence: { tier: MatchConfidenceTier; note: string };
}) {
  const candidates = await prisma.litigationCase.findMany({
    where: { plaintiffCompanyId: params.plaintiffCompanyId, defendantCompanyId: params.defendantCompanyId },
    include: { dockets: { select: { filingDate: true } } },
  });

  for (const candidate of candidates) {
    if (params.plaintiffCompanyId == null && candidate.plaintiffNameRaw !== params.plaintiffNameRaw) continue;
    if (params.defendantCompanyId == null && candidate.defendantNameRaw !== params.defendantNameRaw) continue;
    if (candidate.dockets.length === 0 || !params.filingDate) return candidate;
    const withinWindow = candidate.dockets.some((d) => d.filingDate && daysBetween(d.filingDate, params.filingDate!) <= GROUPING_WINDOW_DAYS);
    if (withinWindow) return candidate;
  }

  return prisma.litigationCase.create({
    data: {
      plaintiffCompanyId: params.plaintiffCompanyId,
      defendantCompanyId: params.defendantCompanyId,
      plaintiffNameRaw: params.plaintiffNameRaw,
      defendantNameRaw: params.defendantNameRaw,
      matchConfidence: params.confidence.tier,
      matchNote: params.confidence.note,
    },
  });
}

export async function loadHitsForCompany(
  hits: RecapSearchHit[],
  company: CompanyRef,
  companiesByNormalizedName: Map<string, CompanyRef[]>,
  opts: { sourceId: string; verifiedAt: Date; issues: RowIssue[] },
): Promise<LoadResult> {
  const { sourceId, verifiedAt, issues } = opts;
  let docketsUpserted = 0;
  const confidenceCounts: Record<MatchConfidenceTier, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  const caseIdsTouchedThisRun = new Set<string>();

  for (const hit of hits) {
    const court = toLitigationCourt(hit.courtId);
    if (!court) {
      issues.push({ file: "courtlistener-search", line: -1, reason: "hit outside DE/NJ despite court-scoped query — source or query-param drift", raw: hit.courtId });
      continue;
    }

    const split = splitCaseName(hit.caseName);
    if (!split) {
      issues.push({ file: "courtlistener-search", line: -1, reason: `caseName didn't match the expected "X v. Y" pattern`, raw: hit.caseName });
      continue;
    }

    const plaintiffMatch = matchCompanyByName(split.plaintiffRaw, companiesByNormalizedName);
    const defendantMatch = matchCompanyByName(split.defendantRaw, companiesByNormalizedName);
    const role = resolveRole(company.id, plaintiffMatch, defendantMatch);
    const candidateDrugIds = role === "plaintiff" ? await resolveCandidateDrugs(company.id) : [];

    const confidence = scoreConfidence({
      role,
      plaintiffMatch,
      defendantMatch,
      candidateDrugIds,
      natureOfSuit: hit.natureOfSuit,
      cause: hit.cause,
    });
    confidenceCounts[confidence.tier]++;

    const filingDate = hit.dateFiled ? new Date(hit.dateFiled) : null;
    const litigationCase = await findOrCreateLitigationCase({
      plaintiffCompanyId: plaintiffMatch.company?.id ?? null,
      defendantCompanyId: defendantMatch.company?.id ?? null,
      plaintiffNameRaw: split.plaintiffRaw,
      defendantNameRaw: split.defendantRaw,
      filingDate,
      confidence,
    });
    caseIdsTouchedThisRun.add(litigationCase.id);

    // Never downgrade an existing case's confidence because of a later,
    // weaker hit that happened to group into it — only raise it.
    if (TIER_RANK[confidence.tier] > TIER_RANK[litigationCase.matchConfidence]) {
      await prisma.litigationCase.update({
        where: { id: litigationCase.id },
        data: { matchConfidence: confidence.tier, matchNote: confidence.note },
      });
    }

    await prisma.litigationDocket.upsert({
      where: { externalDocketId: hit.externalDocketId },
      update: {
        litigationCaseId: litigationCase.id,
        docketNumber: hit.docketNumber,
        court,
        courtRaw: hit.courtId,
        filingDate,
        dateTerminated: hit.dateTerminated ? new Date(hit.dateTerminated) : null,
        judge: hit.assignedTo,
        natureOfSuit: hit.natureOfSuit,
      },
      create: {
        litigationCaseId: litigationCase.id,
        externalDocketId: hit.externalDocketId,
        docketNumber: hit.docketNumber,
        court,
        courtRaw: hit.courtId,
        filingDate,
        dateTerminated: hit.dateTerminated ? new Date(hit.dateTerminated) : null,
        judge: hit.assignedTo,
        natureOfSuit: hit.natureOfSuit,
      },
    });
    docketsUpserted++;

    // Additive only (createMany + skipDuplicates, no deleteMany first) —
    // a single hit's candidateDrugIds only reflects what's derivable from
    // ONE company's data at that moment; blindly re-deriving from scratch
    // per hit could wipe links a stronger earlier hit already established.
    if (candidateDrugIds.length > 0) {
      await prisma.litigationCaseDrug.createMany({
        data: candidateDrugIds.map((drugId) => ({ litigationCaseId: litigationCase.id, drugId })),
        skipDuplicates: true,
      });
    }

    // Recompute earliestFilingDate + outcome from every docket now linked
    // to this case (not just this hit's), so a case's summary fields stay
    // correct as more dockets accumulate across hits/runs.
    const allDockets = await prisma.litigationDocket.findMany({
      where: { litigationCaseId: litigationCase.id },
      select: { filingDate: true, dateTerminated: true },
    });
    const filingDates = allDockets.map((d) => d.filingDate).filter((d): d is Date => d != null);
    const earliestFilingDate = filingDates.length > 0 ? new Date(Math.min(...filingDates.map((d) => d.getTime()))) : null;
    const outcomeDerivation = deriveCaseOutcome(allDockets.map((d) => ({ dateTerminated: d.dateTerminated ? d.dateTerminated.toISOString().slice(0, 10) : null })));
    await prisma.litigationCase.update({
      where: { id: litigationCase.id },
      data: { earliestFilingDate, outcome: outcomeDerivation.outcome, outcomeNote: outcomeDerivation.note },
    });
  }

  // One IngestionRecord per LitigationCase touched this run (same grain as
  // GenericChallenge — one record per entity, not per docket).
  const ingestionRecords = await prisma.ingestionRecord.createMany({
    data: [...caseIdsTouchedThisRun].map((litigationCaseId) => ({ sourceId, litigationCaseId, verifiedAt })),
  });

  return {
    casesTouched: caseIdsTouchedThisRun.size,
    docketsUpserted,
    ingestionRecordsCreated: ingestionRecords.count,
    confidenceCounts,
  };
}
