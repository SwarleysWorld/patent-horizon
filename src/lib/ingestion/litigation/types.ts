// Defined here (not in index.ts, where it's re-exported from for every
// external consumer) so complaintEnrich.ts can use it without a circular
// import back through index.ts, which re-exports complaintEnrich's own
// runComplaintEnrichment.
export const LITIGATION_SOURCE_NAME = "CourtListener RECAP (Hatch-Waxman litigation, D. Del. / D.N.J.)";

// Shape of one skipped/malformed record, kept for logging — never thrown.
// Mirrors orangeBook/purpleBook/paragraphIV's RowIssue exactly.
export interface RowIssue {
  file: "courtlistener-search";
  line: number; // -1 — a search hit has no line-number concept, kept only for shape parity with the other pipelines' RowIssue
  reason: string;
  raw: string;
}

export type LitigationCourtCode = "DE" | "NJ";

// One RECAP docket hit from CourtListener's /api/rest/v4/search/?type=r
// response, field-mapped from the real (confirmed via a live test call —
// see the plan's Verification step 0) response shape, which mixes
// camelCase and snake_case field names inconsistently:
//   caseName, docketNumber, dateFiled, dateTerminated, assignedTo, suitNature
//   docket_id, court_id, cause
// `cause` (e.g. "35:271 Patent Infringement") is an additional, unexpected-
// but-useful corroborating signal for patent-case detection alongside
// suitNature (e.g. "830 Patent") — both are checked in match.ts's
// looksLikePatentCase(). No `docket_number_core` field is present at the
// search-result level (confirmed live), so case grouping in load.ts relies
// only on normalized party-pair + filing-date proximity, not a shared core
// number.
export interface RecapSearchHit {
  externalDocketId: number; // search response's docket_id
  caseName: string; // e.g. "Vanda Pharmaceuticals Inc. v. Teva Pharmaceuticals USA, Inc."
  docketNumber: string;
  courtId: string; // raw court_id, e.g. "deld" / "njd" — validated against LitigationCourtCode by the caller, never trusted blindly
  dateFiled: string | null; // YYYY-MM-DD
  dateTerminated: string | null;
  assignedTo: string | null;
  natureOfSuit: string | null; // suitNature, e.g. "830 Patent"
  cause: string | null; // e.g. "35:271 Patent Infringement"
}

export interface SearchResult {
  status: "ok" | "error";
  hits: RecapSearchHit[];
  errorMessage?: string;
  httpStatus?: number;
  /** true only for a 403/401 — almost certainly a bad/missing API key, not a per-company problem. Callers abort the whole run rather than retry per company. */
  authError?: boolean;
}

// Result of CourtListenerClient.fetchComplaintEntry — see its doc comment.
// "not_scraped"/"no_free_text" are expected, common outcomes, not errors —
// see complaint.ts's ComplaintCheckOutcome for how callers report them.
export interface ComplaintFetchResult {
  status: "found" | "not_scraped" | "no_free_text" | "error";
  plainText?: string;
  documentNumber?: string | null;
  errorMessage?: string;
  authError?: boolean;
}
