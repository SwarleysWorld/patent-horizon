import { z } from "zod";

// ---- Manual entry: Server Action inputs (src/app/data/actions.ts) -----
//
// A manually-entered date/enum goes through the exact same validation as
// a pipeline-sourced one — no laxer rules just because entry is manual.
// `z.iso.date(...)` for every date field, `z.enum([...])` for the same
// closed vocabularies GenericChallenge/LitigationDocket already use
// (submissionDateType, court), same JSDoc-per-field style as
// ListDrugsQuerySchema in src/lib/drugs/schemas.ts.

const ProductRefSchema = z.object({
  productId: z.string().min(1, "pick a product"),
  productSource: z.enum(["orange_book", "purple_book"]),
});

export const ManualPatentSchema = ProductRefSchema.extend({
  patentNumber: z.string().trim().min(1, "patent number is required"),
  coversDrugSubstance: z.boolean(),
  coversDrugProduct: z.boolean(),
  /** Same default-empty-string sentinel as the pipeline-sourced Patent.useCode — see Prisma schema doc comment. */
  useCode: z.string().default(""),
  filingDate: z.iso.date("must be YYYY-MM-DD").nullable(),
  nominalExpiryDate: z.iso.date("must be YYYY-MM-DD"),
  effectiveExpiryDate: z.iso.date("must be YYYY-MM-DD"),
  expiryAdjustmentDays: z.number().int().nullable(),
  submittedDate: z.iso.date("must be YYYY-MM-DD").nullable(),
});

export const ManualExclusivitySchema = ProductRefSchema.extend({
  code: z.string().trim().min(1, "exclusivity code is required"),
  description: z.string().trim().min(1).nullable(),
  grantedDate: z.iso.date("must be YYYY-MM-DD").nullable(),
  expirationDate: z.iso.date("must be YYYY-MM-DD"),
});

export const ManualGenericChallengeSchema = z.object({
  activeIngredient: z.string().trim().min(1, "active ingredient is required"),
  dosageForm: z.string().trim().min(1, "dosage form is required"),
  strength: z.string().trim().min(1, "strength is required"),
  rldName: z.string().trim().min(1, "RLD/brand name is required"),
  /** Optional — used as the matching key against Drug.applicationNumber (see manualEntry/index.ts's previewGenericChallengeMatch). Not a fetch trigger; no live single-NDA lookup exists to reuse. */
  rldNdaNumber: z.string().trim().min(1).nullable(),
  submissionDateType: z.enum(["EXACT_DATE", "PRE_MMA", "RECEIVED_PRIOR_TO"]),
  submissionDate: z.iso.date("must be YYYY-MM-DD").nullable(),
  confirmedDrugId: z.string().min(1).nullable(),
});

export const ManualLitigationDocketSchema = z.object({
  docketNumber: z.string().trim().min(1, "docket number is required"),
  court: z.enum(["DE", "NJ"]),
  externalDocketId: z.number().int().nullable(),
  filingDate: z.iso.date("must be YYYY-MM-DD").nullable(),
  dateTerminated: z.iso.date("must be YYYY-MM-DD").nullable(),
  judge: z.string().trim().min(1).nullable(),
  natureOfSuit: z.string().trim().min(1).nullable(),
});

export const ManualLitigationCaseSchema = z.object({
  plaintiffNameRaw: z.string().trim().min(1, "plaintiff name is required"),
  defendantNameRaw: z.string().trim().min(1, "defendant name is required"),
  plaintiffCompanyId: z.string().min(1).nullable(),
  defendantCompanyId: z.string().min(1).nullable(),
  confirmedDrugId: z.string().min(1).nullable(),
  matchConfidence: z.enum(["HIGH", "MEDIUM", "LOW", "NONE"]),
  matchNote: z.string().trim().min(1).nullable(),
  docket: ManualLitigationDocketSchema,
});

export const PatentNumberLookupSchema = z.object({ patentNumber: z.string().trim().min(1, "patent number is required") });
export const DocketNumberLookupSchema = z.object({ docketNumber: z.string().trim().min(1, "docket number is required") });

export const LinkUnlinkedEntrySchema = z.object({
  entityType: z.enum(["generic_challenge", "litigation_case"]),
  entityId: z.string().min(1),
  drugId: z.string().min(1, "pick a product"),
});
