// Reuses litigation/match.ts's evidence primitives (matchCompanyByName,
// looksLikePatentCase — both role-agnostic, pure) but NOT its
// resolveRole/scoreConfidence, which are inherently relative to "which
// company did we search for" (scoreConfidence's HIGH/first-MEDIUM
// branches gate on role === "plaintiff"). A manual docket lookup has no
// searched company — just two parties to evaluate independently — so this
// is a genuinely different scoring function, not a duplicate of the
// pipeline's.

import { looksLikePatentCase, type CompanyMatch } from "../litigation/match";
import type { ManualMatchConfidence } from "./types";

export interface ManualLitigationScore {
  tier: ManualMatchConfidence;
  note: string;
}

export function scoreManualLitigationMatch(input: {
  plaintiffMatch: CompanyMatch;
  defendantMatch: CompanyMatch;
  candidateDrugIds: string[];
  natureOfSuit: string | null;
  cause: string | null;
}): ManualLitigationScore {
  const patentCase = looksLikePatentCase(input.natureOfSuit, input.cause);
  const bothExact = input.plaintiffMatch.matchType === "exact" && input.defendantMatch.matchType === "exact";
  const eitherMatched = input.plaintiffMatch.company != null || input.defendantMatch.company != null;

  if (bothExact && input.candidateDrugIds.length === 1 && patentCase) {
    return {
      tier: "HIGH",
      note: "Exact match on both parties, nature-of-suit/cause indicates a patent case, and exactly one candidate product.",
    };
  }

  if (bothExact && patentCase) {
    return {
      tier: "MEDIUM",
      note:
        input.candidateDrugIds.length === 0
          ? "Both parties matched exactly and this looks like a patent case, but no specific product could be linked — pick one manually or save unlinked."
          : `Both parties matched exactly and this looks like a patent case, but ${input.candidateDrugIds.length} products are plausible — pick the right one before saving.`,
    };
  }

  if (!eitherMatched) {
    return { tier: "NONE", note: "Neither party name resolved to a known company in this database." };
  }

  if (eitherMatched && patentCase) {
    return {
      tier: "MEDIUM",
      note: "One party matched (exactly or fuzzily), but not both sides — review carefully before linking to a product.",
    };
  }

  return {
    tier: "LOW",
    note: `Weak signal — ${!patentCase ? "nature-of-suit/cause doesn't clearly indicate a patent case" : "matches are fuzzy/partial, not exact"}. Review carefully before linking.`,
  };
}
