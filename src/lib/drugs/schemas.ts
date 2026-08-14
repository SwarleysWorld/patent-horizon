import { z } from "zod";

// ---- Query params: GET /api/drugs -----------------------------------

export const ListDrugsQuerySchema = z.object({
  /** Substring match against brand name, generic name, or company name. Case-insensitive. */
  q: z
    .string()
    .trim()
    .min(1, "must not be empty")
    .max(200, "must be 200 characters or fewer")
    .optional(),
  /**
   * Only include drugs whose estimated generic-entry date is within this
   * many days from now. No lower bound — already-open opportunities
   * (entry date in the past) are included too, since those can still be
   * actionable. Omit to see everything, soonest first.
   */
  withinDays: z.coerce
    .number()
    .int("must be a whole number")
    .min(0, "must be 0 or greater")
    .max(36500, "must be 100 years or fewer")
    .optional(),
  /**
   * Explicit generic-entry date-range bounds, for advanced search. Distinct
   * from `withinDays` (a "next N days from now" shortcut for the primary
   * horizon chips) rather than replacing it — both filter the same
   * underlying estimate and can be combined, though in practice a caller
   * will typically use one or the other.
   */
  expiresAfter: z.iso.date("must be a date in YYYY-MM-DD format").optional(),
  expiresBefore: z.iso.date("must be a date in YYYY-MM-DD format").optional(),
  modality: z.enum(["SMALL_MOLECULE", "PEPTIDE", "OLIGONUCLEOTIDE", "MONOCLONAL_ANTIBODY", "OTHER"]).optional(),
  /** Exact match against Drug.drugClass (e.g. "Statin"), not a substring search. */
  drugClass: z.string().trim().min(1).max(100).optional(),
  applicationType: z.enum(["NDA", "ANDA", "BLA"]).optional(),
  /** Exact match against Drug.dosageForm (e.g. "TABLET"). See GET /api/drugs/filter-options for the current vocabulary. */
  dosageForm: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(["entry_asc", "entry_desc"]).default("entry_asc"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListDrugsQuery = z.infer<typeof ListDrugsQuerySchema>;

// ---- Query params: GET /api/drugs/[id] -------------------------------

export const DrugIdParamSchema = z.object({
  id: z.string().min(1, "must not be empty"),
});

// ---- Shared building blocks -------------------------------------------

export const CompanySchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const PatentSchema = z.object({
  id: z.string(),
  patentNumber: z.string(),
  useCode: z.string(),
  coversDrugSubstance: z.boolean(),
  coversDrugProduct: z.boolean(),
  filingDate: z.iso.date().nullable(),
  nominalExpiryDate: z.iso.date(),
  effectiveExpiryDate: z.iso.date(),
  expiryAdjustmentDays: z.number().int().nullable(),
  submittedDate: z.iso.date().nullable(),
  delistedAt: z.iso.date().nullable(),
});

export const ExclusivitySchema = z.object({
  id: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  grantedDate: z.iso.date().nullable(),
  expirationDate: z.iso.date(),
});

// The product's whole reason to exist: the best current estimate of when a
// generic competitor can enter, and — critically — a transparent
// explanation of which specific patent or exclusivity is actually setting
// that date, so it's never a black box.
export const GenericEntryEstimateSchema = z.object({
  date: z.iso.date().nullable(),
  controllingType: z.enum(["patent", "exclusivity"]).nullable(),
  controllingId: z.string().nullable(),
  /** Human-readable label for the controlling item, e.g. "Patent 6967208" or "Exclusivity NCE". */
  controllingLabel: z.string().nullable(),
  basis: z.string(),
});

const DrugCoreFields = {
  id: z.string(),
  brandName: z.string(),
  genericName: z.string(),
  applicationType: z.enum(["NDA", "ANDA", "BLA"]),
  applicationNumber: z.string(),
  productNumber: z.string(),
  dosageForm: z.string(),
  route: z.string(),
  strength: z.string(),
  approvalDate: z.iso.date().nullable(),
  company: CompanySchema,
  /** Best-effort structural classification — see src/lib/classification/. */
  modality: z.enum(["SMALL_MOLECULE", "PEPTIDE", "OLIGONUCLEOTIDE", "MONOCLONAL_ANTIBODY", "OTHER"]),
  /** Best-effort mechanism/therapeutic-class tag (e.g. "Statin"), or null if unclassified. */
  drugClass: z.string().nullable(),
};

// ---- Response bodies ---------------------------------------------------

export const DrugSummarySchema = z.object({
  ...DrugCoreFields,
  estimatedGenericEntryDate: z.iso.date().nullable(),
  patentCount: z.number().int(),
  exclusivityCount: z.number().int(),
});

export const DrugDetailSchema = z.object({
  ...DrugCoreFields,
  patents: z.array(PatentSchema),
  exclusivities: z.array(ExclusivitySchema),
  genericEntryEstimate: GenericEntryEstimateSchema,
});

export const PaginationSchema = z.object({
  limit: z.number().int(),
  offset: z.number().int(),
  total: z.number().int(),
  hasMore: z.boolean(),
});

export const ListDrugsResponseSchema = z.object({
  data: z.array(DrugSummarySchema),
  pagination: PaginationSchema,
});

export const DrugDetailResponseSchema = z.object({
  data: DrugDetailSchema,
});

// ---- Response body: GET /api/drugs/filter-options ---------------------

// Powers the advanced search UI's select inputs. modality/applicationType
// are the fixed enum vocabularies; drugClass/dosageForm are open-ended (or,
// for dosageForm, simply too numerous — 100+ distinct values — to hardcode)
// so those two are the actual distinct values currently present in the
// data, not a fixed list.
export const FilterOptionsSchema = z.object({
  modalities: z.array(z.object({ value: z.string(), label: z.string() })),
  drugClasses: z.array(z.string()),
  applicationTypes: z.array(z.string()),
  dosageForms: z.array(z.string()),
});

export type DrugSummary = z.infer<typeof DrugSummarySchema>;
export type DrugDetail = z.infer<typeof DrugDetailSchema>;
export type GenericEntryEstimate = z.infer<typeof GenericEntryEstimateSchema>;
export type FilterOptions = z.infer<typeof FilterOptionsSchema>;
