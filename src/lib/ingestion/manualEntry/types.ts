import type { LitigationCourtCode } from "../litigation/types";

// The litigation pipeline's own LitigationMatchConfidence Prisma enum only
// has HIGH/MEDIUM/LOW, because the automated pipeline only ever creates a
// case when *some* hit came back. Manual entry can attempt a lookup and
// get nothing — a real fourth state. There's no schema value for it (not
// worth a migration for a display-only distinction); NONE is stored as
// LOW and distinguished in practice by having zero product links — see
// createManualLitigationCase.
export type ManualMatchConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type ProductSource = "orange_book" | "purple_book";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; message: string };

export interface ManualPatentInput {
  productId: string;
  productSource: ProductSource;
  patentNumber: string;
  coversDrugSubstance: boolean;
  coversDrugProduct: boolean;
  useCode: string;
  filingDate: string | null;
  nominalExpiryDate: string;
  effectiveExpiryDate: string;
  expiryAdjustmentDays: number | null;
  submittedDate: string | null;
}

export interface ManualExclusivityInput {
  productId: string;
  productSource: ProductSource;
  code: string;
  description: string | null;
  grantedDate: string | null;
  expirationDate: string;
}

export interface ManualGenericChallengeInput {
  activeIngredient: string;
  dosageForm: string;
  strength: string;
  rldName: string;
  rldNdaNumber: string | null;
  submissionDateType: "EXACT_DATE" | "PRE_MMA" | "RECEIVED_PRIOR_TO";
  submissionDate: string | null;
  /** Set only when the Analyst reviewed and confirmed a matched (or manually picked) product — see manualEntry/index.ts's previewGenericChallengeMatch. */
  confirmedDrugId: string | null;
}

export interface ManualLitigationDocketInput {
  docketNumber: string;
  court: LitigationCourtCode;
  /** CourtListener's real numeric docket id, when this came from a lookupDocketPreview the Analyst confirmed. Null for a fully hand-typed entry with no CourtListener match. */
  externalDocketId: number | null;
  filingDate: string | null;
  dateTerminated: string | null;
  judge: string | null;
  natureOfSuit: string | null;
}

export interface ManualLitigationCaseInput {
  plaintiffNameRaw: string;
  defendantNameRaw: string;
  plaintiffCompanyId: string | null;
  defendantCompanyId: string | null;
  /** Set only when the Analyst reviewed and confirmed a matched (or manually picked) product. */
  confirmedDrugId: string | null;
  matchConfidence: ManualMatchConfidence;
  matchNote: string | null;
  docket: ManualLitigationDocketInput;
}
