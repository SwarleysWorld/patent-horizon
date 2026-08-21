import { prisma } from "@/lib/prisma";
import { DEFAULT_INGESTION_CONCURRENCY, dedupeByKey, mapWithConcurrency } from "../shared";
import type { ParsedChallenge, RowIssue } from "./types";

const CONCURRENCY = DEFAULT_INGESTION_CONCURRENCY;

export interface LoadResult {
  challengesUpserted: number;
  challengesSkipped: number;
  // Match-rate reporting — never silently dropped, per README.
  matchedToAtLeastOneDrug: number;
  unmatchedNoNdaNumber: number; // source row had no RLD/NDA number at all
  unmatchedNdaNotFound: number; // had a number, but it doesn't resolve to any current Drug
  drugLinksCreated: number;
  ingestionRecordsCreated: number;
}

function naturalKeyNda(c: ParsedChallenge): string {
  return c.rldNdaNumber ?? `NO_NDA:${c.rldName}`;
}

function naturalKey(c: ParsedChallenge): string {
  return `${naturalKeyNda(c)}::${c.activeIngredient}::${c.dosageForm}::${c.strength}`;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((w) => w.replace(/s$/, "")), // crude de-pluralize, good enough to bridge "Tablets" vs "TABLET"
  );
}

function tokensOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (b.has(t)) return true;
  return false;
}

export interface DrugMatch {
  drugIds: string[];
  reason: "matched" | "no_nda_number" | "nda_not_found";
  note: string | null;
}

// See README "Product matching strategy": match by normalized RLD/NDA
// number against every Drug row sharing it (confirmed real: one PIV row's
// strength list can span several Drug rows under one NDA — e.g. Nucynta
// ER resolves to 5 strength/productNumber rows). Narrow by dosage-form
// token overlap only when the matched set spans more than one distinct
// dosage form; never attempt strength-level matching (see README for why
// — incompatible free-text formats on both sides) and never fall back to
// brand-name matching when there's no NDA number (too weak a signal to
// trust silently) — both cases are logged, not guessed.
//
// Exported (narrowed to just the two fields this actually reads, rather
// than the full ParsedChallenge) so src/lib/ingestion/manualEntry can
// reuse the exact same matching logic for a manually-entered
// GenericChallenge with an NDA number, instead of duplicating it.
export async function matchDrugs(challenge: { rldNdaNumber: string | null; dosageForm: string }): Promise<DrugMatch> {
  if (!challenge.rldNdaNumber) {
    return { drugIds: [], reason: "no_nda_number", note: "no RLD/NDA number in source data" };
  }

  const candidates = await prisma.drug.findMany({
    where: { applicationNumber: challenge.rldNdaNumber },
    select: { id: true, dosageForm: true },
  });
  if (candidates.length === 0) {
    return {
      drugIds: [],
      reason: "nda_not_found",
      note: `RLD/NDA ${challenge.rldNdaNumber} does not match any current Drug (discontinued/withdrawn NDA no longer in Orange Book, or a source data anomaly)`,
    };
  }

  const distinctForms = new Set(candidates.map((c) => c.dosageForm));
  if (distinctForms.size <= 1) {
    return { drugIds: candidates.map((c) => c.id), reason: "matched", note: null };
  }

  const wantedTokens = tokenize(challenge.dosageForm);
  const narrowed = candidates.filter((c) => tokensOverlap(wantedTokens, tokenize(c.dosageForm)));
  if (narrowed.length > 0) {
    return { drugIds: narrowed.map((c) => c.id), reason: "matched", note: null };
  }
  return {
    drugIds: candidates.map((c) => c.id),
    reason: "matched",
    note: `dosage form "${challenge.dosageForm}" didn't narrow against [${[...distinctForms].join(", ")}] — linked to all ${candidates.length} products under NDA ${challenge.rldNdaNumber}`,
  };
}

export async function loadParagraphIVData(
  parsed: ParsedChallenge[],
  opts: { sourceId: string; verifiedAt: Date; issues: RowIssue[] },
): Promise<LoadResult> {
  const { sourceId, verifiedAt, issues } = opts;

  const challenges = dedupeByKey(parsed, naturalKey);
  if (challenges.length !== parsed.length) {
    issues.push({
      file: "piv-list.pdf",
      line: -1,
      reason: `deduplicated ${parsed.length - challenges.length} row(s) sharing a natural key already seen in this run`,
      raw: "",
    });
  }

  let challengesUpserted = 0;
  let challengesSkipped = 0;
  let matchedToAtLeastOneDrug = 0;
  let unmatchedNoNdaNumber = 0;
  let unmatchedNdaNotFound = 0;
  let drugLinksCreated = 0;
  const challengeIds: string[] = [];

  await mapWithConcurrency(challenges, CONCURRENCY, async (c) => {
    try {
      const row = await prisma.genericChallenge.upsert({
        where: {
          naturalKeyNda_activeIngredient_dosageForm_strength: {
            naturalKeyNda: naturalKeyNda(c),
            activeIngredient: c.activeIngredient,
            dosageForm: c.dosageForm,
            strength: c.strength,
          },
        },
        update: {
          rldName: c.rldName,
          rldNdaNumber: c.rldNdaNumber,
          rldNdaNumberRaw: c.rldNdaNumberRaw,
          submissionDateType: c.submissionDateType,
          submissionDate: c.submissionDate,
          potentialFirstApplicantAndaCount: c.potentialFirstApplicantAndaCount,
          decisionHistory: c.decisionHistory as unknown as object,
          currentStatus: c.currentStatus,
          dateOfFirstApplicantApproval: c.dateOfFirstApplicantApproval,
          dateOfFirstCommercialMarketing: c.dateOfFirstCommercialMarketing,
          expirationOfLastQualifyingPatent: c.expirationOfLastQualifyingPatent,
          rawStrengthText: c.rawStrengthText,
          rawNotes: c.rawNotes,
        },
        create: {
          naturalKeyNda: naturalKeyNda(c),
          activeIngredient: c.activeIngredient,
          dosageForm: c.dosageForm,
          strength: c.strength,
          rldName: c.rldName,
          rldNdaNumber: c.rldNdaNumber,
          rldNdaNumberRaw: c.rldNdaNumberRaw,
          submissionDateType: c.submissionDateType,
          submissionDate: c.submissionDate,
          potentialFirstApplicantAndaCount: c.potentialFirstApplicantAndaCount,
          decisionHistory: c.decisionHistory as unknown as object,
          currentStatus: c.currentStatus,
          dateOfFirstApplicantApproval: c.dateOfFirstApplicantApproval,
          dateOfFirstCommercialMarketing: c.dateOfFirstCommercialMarketing,
          expirationOfLastQualifyingPatent: c.expirationOfLastQualifyingPatent,
          rawStrengthText: c.rawStrengthText,
          rawNotes: c.rawNotes,
        },
      });
      challengeIds.push(row.id);
      challengesUpserted++;

      const match = await matchDrugs(c);
      if (match.note) {
        issues.push({ file: "piv-list.pdf", line: -1, reason: match.note, raw: `${c.rldName} / ${c.activeIngredient} / ${c.dosageForm}` });
      }
      if (match.reason === "matched") matchedToAtLeastOneDrug++;
      if (match.reason === "no_nda_number") unmatchedNoNdaNumber++;
      if (match.reason === "nda_not_found") unmatchedNdaNotFound++;

      // Re-derive links from scratch on every run rather than only adding
      // new ones — idempotent, and self-heals if a Drug that didn't exist
      // (or didn't match) on a prior run now does (e.g. a newly-ingested
      // Orange Book product, or an improved dosage-form match).
      await prisma.genericChallengeDrug.deleteMany({ where: { genericChallengeId: row.id } });
      if (match.drugIds.length > 0) {
        const created = await prisma.genericChallengeDrug.createMany({
          data: match.drugIds.map((drugId) => ({ genericChallengeId: row.id, drugId })),
          skipDuplicates: true,
        });
        drugLinksCreated += created.count;
      }
    } catch (error) {
      challengesSkipped++;
      issues.push({
        file: "piv-list.pdf",
        line: -1,
        reason: `DB upsert failed: ${error instanceof Error ? error.message : String(error)}`,
        raw: `${c.rldName} / ${c.activeIngredient} / ${c.dosageForm} / ${c.strength}`,
      });
    }
  });

  const ingestionRecords = await prisma.ingestionRecord.createMany({
    data: challengeIds.map((genericChallengeId) => ({ sourceId, genericChallengeId, verifiedAt })),
  });

  return {
    challengesUpserted,
    challengesSkipped,
    matchedToAtLeastOneDrug,
    unmatchedNoNdaNumber,
    unmatchedNdaNotFound,
    drugLinksCreated,
    ingestionRecordsCreated: ingestionRecords.count,
  };
}
