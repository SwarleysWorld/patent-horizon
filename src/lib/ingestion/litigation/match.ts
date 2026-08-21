// Pure matching/scoring logic for the litigation pipeline — no DB writes,
// only reads (via matchCompanyByName's precomputed map, passed in). Kept
// separate from load.ts so this, the part that actually holds all the
// judgment calls, is independently unit-testable with no mocking needed.

import { prisma } from "@/lib/prisma";
import type { LitigationCourtCode, RecapSearchHit } from "./types";

// ---- Party-name extraction from a case caption --------------------------

export interface CaseNameSplit {
  plaintiffRaw: string;
  defendantRaw: string;
}

// Federal case captions are "Plaintiff v. Defendant" by convention. If a
// caption doesn't split cleanly into exactly two sides, return null —
// callers log a RowIssue and skip the hit rather than guessing which name
// is which.
export function splitCaseName(caseName: string): CaseNameSplit | null {
  const parts = caseName.split(/\s+v\.?s?\.?\s+/i);
  if (parts.length !== 2) return null;
  const plaintiffRaw = parts[0].trim();
  const defendantRaw = parts[1].trim();
  if (!plaintiffRaw || !defendantRaw) return null;
  return { plaintiffRaw, defendantRaw };
}

// ---- Company-name normalization ------------------------------------------

// New, small helper — NOT a reuse of paragraphIV/load.ts's tokenize/
// tokensOverlap (those are tuned for dosage-form free text, where "any
// token overlap" is a reasonable bar). Company names are proper nouns,
// where partial overlap is a much weaker signal — "Pharma" overlapping
// "Pharma Corp X" alone shouldn't count as a match — so this needs its own
// stricter normalization and comparison.
const CORPORATE_SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "llc", "ltd", "limited",
  "co", "company", "usa", "pharmaceuticals", "pharmaceutical", "pharma",
]);

export function normalizeCompanyName(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && CORPORATE_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

function tokenSet(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(Boolean));
}

// Stricter than paragraphIV's "any overlap": every token of the SHORTER
// normalized name must appear in the longer one. "teva" (from "Teva
// Pharmaceuticals USA, Inc.") inside "teva pharmaceutical industries" ->
// true. "pharma" alone inside "pharma corp x" -> true only if "pharma" is
// literally the entire shorter side, which is itself a weak, generic
// single-token match callers should treat cautiously (see matchCompanyByName).
function allTokensContained(shorter: Set<string>, longer: Set<string>): boolean {
  if (shorter.size === 0) return false;
  for (const t of shorter) if (!longer.has(t)) return false;
  return true;
}

// ---- Company resolution ---------------------------------------------------

export interface CompanyRef {
  id: string;
  name: string;
}

export interface CompanyMatch {
  company: CompanyRef | null;
  matchType: "exact" | "fuzzy" | "none";
}

// `companiesByNormalizedName` is precomputed ONCE per pipeline run (see
// index.ts) and passed in here — never re-fetch per hit.
export function matchCompanyByName(rawName: string, companiesByNormalizedName: Map<string, CompanyRef[]>): CompanyMatch {
  const normalized = normalizeCompanyName(rawName);
  if (!normalized) return { company: null, matchType: "none" };

  const exact = companiesByNormalizedName.get(normalized);
  if (exact && exact.length === 1) return { company: exact[0], matchType: "exact" };
  if (exact && exact.length > 1) return { company: null, matchType: "none" }; // ambiguous exact match — never guess among ties

  const normalizedTokens = tokenSet(normalized);
  const fuzzyCandidates: CompanyRef[] = [];
  for (const [candidateNormalized, companies] of companiesByNormalizedName) {
    const candidateTokens = tokenSet(candidateNormalized);
    const [shorter, longer] = normalizedTokens.size <= candidateTokens.size ? [normalizedTokens, candidateTokens] : [candidateTokens, normalizedTokens];
    if (allTokensContained(shorter, longer)) fuzzyCandidates.push(...companies);
  }
  const uniqueFuzzy = [...new Map(fuzzyCandidates.map((c) => [c.id, c])).values()];
  if (uniqueFuzzy.length === 1) return { company: uniqueFuzzy[0], matchType: "fuzzy" };
  return { company: null, matchType: "none" }; // zero or multiple fuzzy candidates — never guess among ties
}

// ---- Role resolution --------------------------------------------------

export type LitigationRole = "plaintiff" | "defendant" | "unmatched";

// Which side, if either, our searched company landed on.
export function resolveRole(searchedCompanyId: string, plaintiffMatch: CompanyMatch, defendantMatch: CompanyMatch): LitigationRole {
  if (plaintiffMatch.company?.id === searchedCompanyId) return "plaintiff"; // typical Hatch-Waxman shape: brand sues generic
  if (defendantMatch.company?.id === searchedCompanyId) return "defendant"; // atypical but real (e.g. a declaratory-judgment suit filed by the ANDA applicant)
  return "unmatched"; // a full-text search hit that doesn't actually resolve to our company as either party — likely noise
}

// ---- Candidate product resolution (DB read only, no writes) -----------

// That company's Drugs that ALSO have a GenericChallenge link — the actual
// evidence this company's litigation is Hatch-Waxman-shaped for a
// SPECIFIC product, not just "this company has many products."
export async function resolveCandidateDrugs(companyId: string): Promise<string[]> {
  const drugs = await prisma.drug.findMany({
    where: { companyId, challengeLinks: { some: {} } },
    select: { id: true },
  });
  return drugs.map((d) => d.id);
}

// ---- Nature-of-suit / cause patent-case detection --------------------

// Federal Nature-of-Suit code 830 = Patent; 35 U.S.C. §271 and 28 U.S.C.
// §1338 are the patent-infringement statutes CourtListener's `cause` field
// commonly cites — checking both `natureOfSuit` and `cause` since either
// may be the only one populated on a given hit (confirmed live: some hits
// have neither field populated at all).
export function looksLikePatentCase(natureOfSuit: string | null, cause: string | null): boolean {
  const text = `${natureOfSuit ?? ""} ${cause ?? ""}`;
  return /\b830\b/.test(text) || /patent/i.test(text);
}

// ---- Confidence scoring -------------------------------------------------

export type MatchConfidenceTier = "HIGH" | "MEDIUM" | "LOW";

export interface ConfidenceScore {
  tier: MatchConfidenceTier;
  note: string;
}

export function scoreConfidence(input: {
  role: LitigationRole;
  plaintiffMatch: CompanyMatch;
  defendantMatch: CompanyMatch;
  candidateDrugIds: string[];
  natureOfSuit: string | null;
  cause: string | null;
}): ConfidenceScore {
  const patentCase = looksLikePatentCase(input.natureOfSuit, input.cause);

  if (input.role === "plaintiff" && input.plaintiffMatch.matchType === "exact" && input.defendantMatch.company != null && input.candidateDrugIds.length === 1 && patentCase) {
    return {
      tier: "HIGH",
      note: "Exact match on both parties, nature-of-suit/cause indicates a patent case, and exactly one linked product (with an existing FDA Paragraph IV filing) to attach to.",
    };
  }

  if (input.role === "plaintiff" && input.plaintiffMatch.matchType === "exact" && patentCase) {
    if (input.candidateDrugIds.length === 0 || input.candidateDrugIds.length > 1) {
      return {
        tier: "MEDIUM",
        note: `Plaintiff matched exactly and nature-of-suit/cause indicates a patent case, but ${
          input.candidateDrugIds.length === 0
            ? "no specific product could be linked"
            : `${input.candidateDrugIds.length} products are plausible matches — ambiguous which one this dispute concerns`
        }.`,
      };
    }
    if (input.defendantMatch.company == null) {
      return {
        tier: "MEDIUM",
        note: "Plaintiff matched exactly to one product, but the defendant name didn't resolve to any known company in this database.",
      };
    }
  }

  const reasons: string[] = [];
  if (input.role === "unmatched") reasons.push("neither party name resolved to our searched company with confidence");
  if (input.plaintiffMatch.matchType === "fuzzy") reasons.push("plaintiff match was fuzzy/partial, not exact");
  if (input.role === "defendant") reasons.push("our company appears as the defendant, a weaker signal than the typical brand-sues-generic Hatch-Waxman filing shape");
  if (!patentCase) reasons.push("nature-of-suit/cause doesn't indicate a patent case");
  return {
    tier: "LOW",
    note: `Weak signal — ${reasons.length > 0 ? reasons.join("; ") : "matched, but without strong corroborating evidence"}. Case recorded for visibility but treat the party/product attribution as unverified.`,
  };
}

// ---- Outcome derivation --------------------------------------------------

export interface OutcomeDerivation {
  outcome: "ONGOING" | "UNCLEAR";
  note: string;
}

// Derived only from data already fetched in the search hit(s) — no extra
// request. Anything more specific (SETTLED/DISMISSED/RULING_FOR_*/
// TRANSFERRED) needs docket-entries keyword-scanning, deliberately
// deferred to a future pass (see index.ts doc comment) rather than
// guessed here.
export function deriveCaseOutcome(dockets: { dateTerminated: string | null }[]): OutcomeDerivation {
  if (dockets.some((d) => d.dateTerminated == null)) {
    return { outcome: "ONGOING", note: "At least one linked docket has no termination date on record." };
  }
  return {
    outcome: "UNCLEAR",
    note: "All linked dockets show a termination date, but CourtListener's docket-level metadata alone doesn't indicate how the case concluded (settlement, dismissal, ruling, or transfer) — not inferred automatically in this pass.",
  };
}

// ---- Court validation ------------------------------------------------

export function toLitigationCourt(courtId: string): LitigationCourtCode | null {
  if (courtId === "deld") return "DE";
  if (courtId === "njd") return "NJ";
  return null; // defensive — the search is already court-scoped to deld,njd, but never trust the source blindly
}

export function validateHit(hit: RecapSearchHit): LitigationCourtCode | null {
  return toLitigationCourt(hit.courtId);
}
