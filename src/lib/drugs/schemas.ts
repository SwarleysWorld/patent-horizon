import { z } from "zod";
import { MODALITY_VALUES } from "@/lib/classification/modality";

// ---- Query params: GET /api/drugs -----------------------------------

// Multi-value filters arrive as a single comma-separated query param
// (`?modality=PEPTIDE,MONOCLONAL_ANTIBODY`), not repeated keys — simpler to
// build/read from a URL-driven UI, and none of these values can themselves
// contain a comma. Values within one param combine with OR (any match);
// separate params combine with AND — e.g. `?modality=PEPTIDE&source=orange_book`
// requires both.
function csvParam(opts: { max: number; itemMax: number }) {
  return z
    .string()
    .transform((s) => s.split(",").map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.string().max(opts.itemMax)).min(1).max(opts.max))
    .optional();
}

function csvEnumParam<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .transform((s) => s.split(",").map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1))
    .optional();
}

export const ListDrugsQuerySchema = z.object({
  /** Substring match against brand/proprietary name, generic/proper name, or company name. Case-insensitive. */
  q: z
    .string()
    .trim()
    .min(1, "must not be empty")
    .max(200, "must be 200 characters or fewer")
    .optional(),
  /**
   * Only include results whose estimated generic-entry date is within this
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
  /** Comma-separated. */
  modality: csvEnumParam(MODALITY_VALUES),
  /** Comma-separated. Exact match against drugClass (e.g. "Statin"), not a substring search. */
  drugClass: csvParam({ max: 20, itemMax: 100 }),
  /** Comma-separated. Only ever matches Orange Book (small-molecule) results — see `source`. */
  applicationType: csvEnumParam(["NDA", "ANDA", "BLA"]),
  /** Comma-separated. Exact match against dosageForm. See GET /api/drugs/filter-options for the current vocabulary. */
  dosageForm: csvParam({ max: 20, itemMax: 100 }),
  /** Comma-separated. Exact match against route of administration. */
  route: csvParam({ max: 20, itemMax: 100 }),
  /** Comma-separated. Exact match against the applicant/company name. */
  applicant: csvParam({ max: 20, itemMax: 200 }),
  /** Comma-separated. Which data source(s) to include — omit for both. */
  source: csvEnumParam(["orange_book", "purple_book"]),
  /**
   * Comma-separated. Requires at least one currently-listed (non-delisted)
   * patent of the given type(s) — substance/product/use, mirroring Orange
   * Book's own coversDrugSubstance/coversDrugProduct/useCode flags.
   */
  patentType: csvEnumParam(["substance", "product", "use"]),
  /** Comma-separated. Exact match against an exclusivity code (e.g. "NCE", "BPCIA_REF_PRODUCT"). */
  exclusivityCode: csvParam({ max: 20, itemMax: 100 }),
  /**
   * The clearest demonstration of this product's core value: only include
   * results with at least one patent whose USPTO Patent Term Adjustment
   * shifted its expiry by at least this many days versus the originally
   * listed date. Surfaced prominently in the UI (its own column/sort), not
   * buried as just another filter.
   */
  minPtaGapDays: z.coerce.number().int().min(0).max(3650).optional(),
  /** Presence-only filter (`?hasGenericChallenge=true`) — omit for no filter. Requires at least one linked FDA Paragraph IV generic-challenge filing. Orange Book only (see GenericChallengeSchema). */
  hasGenericChallenge: z.literal("true").optional(),
  /** Presence-only filter (`?hasFirstCommercialMarketingDate=true`) — omit for no filter. Requires a real Date of First Commercial Marketing on file from a linked generic-challenge filing — i.e. a generic has actually entered the market, independent of whether FDA made a 180-day decision. */
  hasFirstCommercialMarketingDate: z.literal("true").optional(),
  /** Presence-only filter (`?hasLitigation=true`) — omit for no filter. Requires at least one linked federal Hatch-Waxman/ANDA litigation case from CourtListener's RECAP archive (District of Delaware / District of New Jersey only). Orange Book only — see `LitigationCaseSchema`. */
  hasLitigation: z.literal("true").optional(),
  sort: z.enum(["entry_asc", "entry_desc", "pta_gap_desc"]).default("entry_asc"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListDrugsQuery = z.infer<typeof ListDrugsQuerySchema>;

// ---- Query params: GET /api/search/autocomplete -----------------------

export const AutocompleteQuerySchema = z.object({
  q: z.string().trim().min(1, "must not be empty").max(200, "must be 200 characters or fewer"),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

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
  /** True when this row's most recent IngestionRecord is from the "Manual Entry" source, not an automated pipeline — see src/lib/ingestion/manualEntry. */
  manuallyEntered: z.boolean(),
});

export const ExclusivitySchema = z.object({
  id: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  grantedDate: z.iso.date().nullable(),
  expirationDate: z.iso.date(),
  /** Same provenance flag as PatentSchema.manuallyEntered. */
  manuallyEntered: z.boolean(),
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
  /**
   * Whether `date` can be trusted as-is. "confirmed": controlled by an FDA
   * exclusivity (always FDA-final, no separate verification step applies),
   * or by a patent whose term has been independently checked against USPTO
   * Patent Term Adjustment records. "pending_verification": controlled by
   * a patent that hasn't been checked yet — `date` is still just the
   * source's (Orange/Purple Book's) own listed expiry and could shift once
   * verified. Null only when there's no controlling item at all (`date` is
   * also null in that case).
   */
  dateConfidence: z.enum(["confirmed", "pending_verification"]).nullable(),
  basis: z.string(),
});

const SharedProductFields = {
  dosageForm: z.string(),
  route: z.string(),
  strength: z.string(),
  approvalDate: z.iso.date().nullable(),
  company: CompanySchema,
  /** Best-effort structural classification — see src/lib/classification/. */
  modality: z.enum(MODALITY_VALUES),
  /** Best-effort mechanism/therapeutic-class tag (e.g. "Statin"), or null if unclassified. */
  drugClass: z.string().nullable(),
};

// ---- Response body: GET /api/drugs (unified list/search) --------------

// One shape spanning both sources — Orange Book (small molecules) and
// Purple Book (biologics) — so the list/search endpoint can rank and
// paginate across both together, the way an analyst actually wants to
// browse "what's expiring soon" regardless of modality. `name`/
// `alternateName` are deliberately source-neutral (brandName/genericName
// for a Drug, proprietaryName/properName for a BiologicProduct) rather than
// force-fitting Orange Book's own field names onto biologics. The two
// source-specific classification fields (`applicationType`,
// `licenseType`) are both nullable and mutually exclusive — exactly one is
// set, matching which `source` the result came from — rather than force-
// fitting one vocabulary onto the other (a BLA's 351(a)/(k) license type
// isn't the same concept as an NDA/ANDA application type, even though both
// answer "what kind of application is this").
export const SearchResultSchema = z.object({
  id: z.string(),
  source: z.enum(["orange_book", "purple_book"]),
  name: z.string(),
  alternateName: z.string(),
  applicationType: z.enum(["NDA", "ANDA", "BLA"]).nullable(),
  licenseType: z.enum(["STANDARD", "BIOSIMILAR", "INTERCHANGEABLE"]).nullable(),
  ...SharedProductFields,
  estimatedGenericEntryDate: z.iso.date().nullable(),
  /** Same meaning as `GenericEntryEstimateSchema.dateConfidence` — whether `estimatedGenericEntryDate` is USPTO-verified or still just the source's listed figure. Null when `estimatedGenericEntryDate` is null. */
  dateConfidence: z.enum(["confirmed", "pending_verification"]).nullable(),
  patentCount: z.number().int(),
  exclusivityCount: z.number().int(),
  /** Largest known USPTO Patent Term Adjustment gap (days) among this result's current patents, or null if none is known yet. See `minPtaGapDays` on the list query. */
  maxPtaGapDays: z.number().int().nullable(),
  /** Whether this drug has at least one linked FDA Paragraph IV generic-challenge filing. Orange Book (small-molecule) results only — see `GenericChallengeSchema`. */
  hasGenericChallenge: z.boolean(),
  /** Whether this drug has at least one linked federal Hatch-Waxman/ANDA litigation case. Orange Book (small-molecule) results only — see `LitigationCaseSchema`. */
  hasLitigation: z.boolean(),
});

// ---- Paragraph IV / generic-challenge tracking -------------------------
//
// Sourced from FDA's Paragraph IV Patent Certifications List — a signal
// that a generic company has filed (or resolved) a patent challenge
// against this drug, tracked entirely separately from patents/
// exclusivities. See README "Data ingestion: Paragraph IV Certifications"
// for the full field provenance and FDA's own stated caveat that its
// regulatory decisions are based on the underlying applications, not this
// published list.
export const GenericChallengeDecisionEntrySchema = z.object({
  status: z.enum(["ELIGIBLE", "DEFERRED", "NON_FORFEITURE", "EXTINGUISHED"]),
  postingDate: z.iso.date().nullable(),
  rawStatusText: z.string(),
});

export const GenericChallengeSchema = z.object({
  id: z.string(),
  activeIngredient: z.string(),
  dosageForm: z.string(),
  strength: z.string(),
  rldName: z.string(),
  rldNdaNumber: z.string().nullable(),
  submissionDateType: z.enum(["EXACT_DATE", "PRE_MMA", "RECEIVED_PRIOR_TO"]),
  submissionDate: z.iso.date().nullable(),
  potentialFirstApplicantAndaCount: z.number().int().nullable(),
  /** Most-recent-first, matching FDA's own stated ordering — see the Prisma schema doc comment. Empty array means no 180-day decision has been made yet. */
  decisionHistory: z.array(GenericChallengeDecisionEntrySchema),
  currentStatus: z.enum(["ELIGIBLE", "DEFERRED", "NON_FORFEITURE", "EXTINGUISHED"]).nullable(),
  dateOfFirstApplicantApproval: z.iso.date().nullable(),
  dateOfFirstCommercialMarketing: z.iso.date().nullable(),
  /**
   * Reference-only — FDA's own definition of this field excludes
   * pediatric exclusivity and reflects only patents with a Paragraph IV
   * certification, not the drug's full protection picture. Never treated
   * as authoritative or as a substitute for the drug's own computed
   * `genericEntryEstimate.date`.
   */
  expirationOfLastQualifyingPatent: z.iso.date().nullable(),
  /** Same provenance flag as PatentSchema.manuallyEntered. */
  manuallyEntered: z.boolean(),
});

// ---- Federal litigation tracking (CourtListener RECAP) -----------------
//
// Deliberately the LOWEST-confidence source on this page. Every other
// source here (Orange/Purple Book, PTA, Paragraph IV) links to a product
// via an exact ID field (NDA/RLD/patent number); litigation is linked by
// company-name matching, a heuristic — matchConfidence and matchNote must
// always render alongside this data and must never be presented with the
// same visual certainty as the rest of the page. Scoped to Hatch-Waxman/
// ANDA litigation in the District of Delaware and District of New Jersey
// only. See README "Data ingestion: Federal Litigation Tracking" and
// src/components/drugs/LitigationCallout.tsx.
export const LitigationDocketSchema = z.object({
  id: z.string(),
  docketNumber: z.string(),
  court: z.enum(["DE", "NJ"]),
  filingDate: z.iso.date().nullable(),
  dateTerminated: z.iso.date().nullable(),
  judge: z.string().nullable(),
  natureOfSuit: z.string().nullable(),
});

export const LitigationCaseSchema = z.object({
  id: z.string(),
  /** Company.name if the plaintiff resolved to a known company, else the raw case-caption text — see `plaintiffMatched`. */
  plaintiffName: z.string(),
  plaintiffMatched: z.boolean(),
  defendantName: z.string(),
  defendantMatched: z.boolean(),
  earliestFilingDate: z.iso.date().nullable(),
  outcome: z.enum(["ONGOING", "SETTLED", "DISMISSED", "RULING_FOR_PLAINTIFF", "RULING_FOR_DEFENDANT", "TRANSFERRED", "UNCLEAR"]),
  /** Explains how `outcome` was derived — e.g. why it's UNCLEAR rather than a specific resolution. */
  outcomeNote: z.string().nullable(),
  matchConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  /** Always shown in the UI, not hidden behind a tooltip — the "why" behind `matchConfidence`. */
  matchNote: z.string().nullable(),
  /** One dispute can span multiple actual court dockets — see LitigationDocket's Prisma doc comment. */
  dockets: z.array(LitigationDocketSchema),
  /** Same provenance flag as PatentSchema.manuallyEntered — set when this dispute was entered/fetched directly by an Analyst rather than the automated RECAP pipeline. */
  manuallyEntered: z.boolean(),
});

// ---- Response body: GET /api/drugs/[id] (Orange Book detail) ----------

export const DrugDetailSchema = z.object({
  id: z.string(),
  brandName: z.string(),
  genericName: z.string(),
  applicationType: z.enum(["NDA", "ANDA", "BLA"]),
  applicationNumber: z.string(),
  productNumber: z.string(),
  ...SharedProductFields,
  patents: z.array(PatentSchema),
  exclusivities: z.array(ExclusivitySchema),
  genericEntryEstimate: GenericEntryEstimateSchema,
  /** Empty for the overwhelming majority of drugs — see README for real match-rate numbers. Orange Book only; biosimilars use the separate BPCIA patent-dance process already tracked via Purple Book's own patent list. */
  genericChallenges: z.array(GenericChallengeSchema),
  /** Empty for the overwhelming majority of drugs. Orange Book only — see LitigationCaseSchema's doc comment on confidence. */
  litigationCases: z.array(LitigationCaseSchema),
});

// ---- Response body: GET /api/biologics/[id] (Purple Book detail) ------

export const BiologicReferenceSchema = z.object({
  id: z.string(),
  proprietaryName: z.string(),
  properName: z.string(),
});

export const BiologicDetailSchema = z.object({
  id: z.string(),
  proprietaryName: z.string(),
  properName: z.string(),
  licenseType: z.enum(["STANDARD", "BIOSIMILAR", "INTERCHANGEABLE"]),
  center: z.enum(["CDER", "CBER"]),
  blaNumber: z.string(),
  productNumber: z.string(),
  marketingStatus: z.string().nullable(),
  ...SharedProductFields,
  referenceProduct: BiologicReferenceSchema.nullable(),
  referenceProductNameRaw: z.string().nullable(),
  biosimilarsAndInterchangeables: z.array(BiologicReferenceSchema),
  patents: z.array(PatentSchema),
  exclusivities: z.array(ExclusivitySchema),
  genericEntryEstimate: GenericEntryEstimateSchema,
});

// ---- Shared response envelopes -----------------------------------------

export const PaginationSchema = z.object({
  limit: z.number().int(),
  offset: z.number().int(),
  total: z.number().int(),
  hasMore: z.boolean(),
});

export const ListDrugsResponseSchema = z.object({
  data: z.array(SearchResultSchema),
  pagination: PaginationSchema,
  /** Result counts per filter value, scoped by every OTHER currently-active filter — powers the UI's "(154)" counts next to each option. */
  facets: z.record(z.string(), z.array(z.object({ value: z.string(), count: z.number().int() }))),
});

export const DrugDetailResponseSchema = z.object({
  data: DrugDetailSchema,
});

export const BiologicDetailResponseSchema = z.object({
  data: BiologicDetailSchema,
});

// ---- Response body: GET /api/drugs/filter-options ---------------------

// Powers the advanced search UI's select inputs. modality/applicationType/
// source are fixed vocabularies (enums), so every possible value is
// offered — including ones with zero current matches (see
// src/lib/drugs/queries.ts's getFilterOptions for why that's deliberate).
// drugClass is likewise a fixed vocabulary we control. dosageForm/route/
// applicant are genuinely open-ended free text from the source data, so
// those are the actual distinct values currently present (combined across
// both sources), not a fixed list.
export const FilterOptionsSchema = z.object({
  modalities: z.array(z.object({ value: z.string(), label: z.string() })),
  drugClasses: z.array(z.string()),
  applicationTypes: z.array(z.string()),
  sources: z.array(z.object({ value: z.string(), label: z.string() })),
  patentTypes: z.array(z.object({ value: z.string(), label: z.string() })),
  dosageForms: z.array(z.string()),
  routes: z.array(z.string()),
  applicants: z.array(z.string()),
  exclusivityCodes: z.array(z.string()),
});

// ---- Response body: GET /api/search/autocomplete -----------------------

export const AutocompleteResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      source: z.enum(["orange_book", "purple_book"]),
      name: z.string(),
      alternateName: z.string(),
    }),
  ),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;
export type DrugDetail = z.infer<typeof DrugDetailSchema>;
export type BiologicDetail = z.infer<typeof BiologicDetailSchema>;
export type GenericEntryEstimate = z.infer<typeof GenericEntryEstimateSchema>;
export type FilterOptions = z.infer<typeof FilterOptionsSchema>;
