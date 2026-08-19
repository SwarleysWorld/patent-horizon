// Shape of one skipped/malformed row, kept for logging — never thrown.
// Mirrors orangeBook/purpleBook's RowIssue exactly.
export interface RowIssue {
  file: "piv-list.pdf";
  line: number; // the PDF row's 1-based index within the parsed table, or -1 when not row-specific
  reason: string;
  raw: string;
}

export type PivSubmissionDateType = "EXACT_DATE" | "PRE_MMA" | "RECEIVED_PRIOR_TO";
export type PivDecisionStatus = "ELIGIBLE" | "DEFERRED" | "NON_FORFEITURE" | "EXTINGUISHED";

export interface DecisionHistoryEntry {
  status: PivDecisionStatus;
  postingDate: string | null; // ISO date, or null when the source lists this status with no matching posting-date entry
  rawStatusText: string; // the source's own text for this entry, e.g. "40 u/100 mL - Extinguished" — preserved verbatim since the enum alone can't capture a per-strength qualifier
}

// One row parsed from the PDF, before DB matching.
export interface ParsedChallenge {
  activeIngredient: string;
  dosageForm: string;
  strength: string; // raw cell, may list multiple strengths

  rldName: string;
  rldNdaNumber: string | null; // normalized "NDA" + 6 digits, or null if the source row has none
  rldNdaNumberRaw: string | null; // present only when a number-like value existed but didn't cleanly normalize

  submissionDateType: PivSubmissionDateType;
  submissionDate: Date | null;

  potentialFirstApplicantAndaCount: number | null;

  decisionHistory: DecisionHistoryEntry[];
  currentStatus: PivDecisionStatus | null;

  dateOfFirstApplicantApproval: Date | null;
  dateOfFirstCommercialMarketing: Date | null;
  expirationOfLastQualifyingPatent: Date | null;

  rawStrengthText: string;
  rawNotes: string | null;
}

export interface ParseResult {
  challenges: ParsedChallenge[];
  issues: RowIssue[];
  rawCount: number;
}
