// Client for CourtListener's REST API v4 RECAP docket search, used to find
// Hatch-Waxman/ANDA litigation involving companies already in this
// database. Docs: https://www.courtlistener.com/help/api/rest/v4/
//
// Rate limits (free authenticated tier): 5 req/min, 50/hour, 125/day,
// rolling window — no bulk-download alternative exists for RECAP docket
// data (unlike every other pipeline in this app). This client is built
// around one in-flight request at a time, same shape as
// src/lib/ingestion/pta/client.ts (the only other live-API client here).
//
// Field names below were confirmed against a real, unauthenticated test
// call to /api/rest/v4/search/?type=r&q=teva&court=deld,njd — the response
// mixes camelCase (caseName, docketNumber, dateFiled, dateTerminated,
// assignedTo, suitNature) and snake_case (docket_id, court_id) field names
// inconsistently; that's the source's own shape, not a typo here. `court=`
// with a comma-separated list confirmed to AND correctly with `q=` (every
// result returned was scoped to the requested courts).

import type { RecapSearchHit, SearchResult, ComplaintFetchResult } from "./types";

const SEARCH_URL = "https://www.courtlistener.com/api/rest/v4/search/";
const DOCKET_ENTRIES_URL = "https://www.courtlistener.com/api/rest/v4/docket-entries/";

// 5 req/min is the binding constraint (tighter than 50/hour ÷ 60 ≈ 0.83/min
// and 125/day). 60_000ms / 5 = 12_000ms exactly; padded to 13_000ms to
// leave real margin against the rolling window's own edges.
const MIN_DELAY_MS = 13_000;
// Fewer retries than PTA's 5 — at 5 req/min, each retry burns a
// disproportionate share of the run's whole budget on one company. Fail
// this company and move on to the next rather than exhaust the budget here.
const MAX_429_RETRIES = 3;
const BACKOFF_ON_429_MS = 65_000; // > one full rolling minute, to guarantee the window clears

// v1 fetches only the first page of results per company search (20 hits,
// CourtListener's default page size) and does not follow `next` cursors.
// Scoped to companies with an existing Paragraph IV filing, most real
// litigation should rank near the top by relevance; chasing pagination
// would multiply the per-company request cost well past the ~1-request
// budget this whole pipeline design relies on.

export class CourtListenerClient {
  private readonly apiKey: string;
  private lastRequestAt = 0;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async throttle() {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < MIN_DELAY_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_DELAY_MS - elapsed));
    }
  }

  async searchHatchWaxmanCases(companyName: string): Promise<SearchResult> {
    return this.executeSearch(encodeURIComponent(companyName));
  }

  // Used by manual entry (src/lib/ingestion/manualEntry) to fetch one
  // specific docket by its human-readable case number, rather than a
  // company-name search. Verified live: `q=docketNumber:"<number>"` scoped
  // to `court=deld,njd` returns exactly one precise hit for a real docket
  // already in this DB (confirmed against Taro Pharmaceutical Industries
  // v. Novitium, docket 3:19-cv-01028, njd) — 15 results across unrelated
  // districts came back when the court scope was omitted, since docket
  // numbers aren't unique across courts, so the existing DE/NJ scoping is
  // load-bearing here too, not just an optimization.
  async lookupByDocketNumber(docketNumber: string): Promise<SearchResult> {
    return this.executeSearch(`docketNumber:${encodeURIComponent(`"${docketNumber}"`)}`);
  }

  // Fetches docket entry #1 for an already-known docket (by CourtListener's
  // own numeric docket id, the same externalDocketId already stored on
  // LitigationDocket) — Hatch-Waxman/ANDA complaints are essentially always
  // filed as Document 1. Shares this same client's throttle/backoff with
  // searchHatchWaxmanCases and lookupByDocketNumber (CourtListener's rate
  // limit is per-account across the whole v4 REST API, not per-endpoint —
  // confirmed via a live test call returning entries with nested
  // recap_documents[] carrying both `is_available` and, when true, an
  // already-OCR'd `plain_text` field, so no PDF fetch/OCR is needed on our
  // end for anything CourtListener already has for free — see
  // complaint.ts's doc comment for the full shape confirmed live).
  //
  // "not_scraped" (no docket-entries at all for this docket in
  // CourtListener's system) and "no_free_text" (entry #1 exists but no
  // attached document has plain_text — e.g. paid-only, or an image-only
  // scan CourtListener hasn't OCR'd) are both real, common, and distinct
  // from "error" — callers must not treat them as failures.
  async fetchComplaintEntry(externalDocketId: number): Promise<ComplaintFetchResult> {
    const url = `${DOCKET_ENTRIES_URL}?docket=${externalDocketId}&entry_number=1`;

    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      await this.throttle();
      this.lastRequestAt = Date.now();

      let res: Response;
      try {
        res = await fetch(url, { headers: { Authorization: `Token ${this.apiKey}`, accept: "application/json" } });
      } catch (error) {
        return { status: "error", errorMessage: `network error: ${error instanceof Error ? error.message : String(error)}` };
      }

      if (res.status === 429) {
        if (attempt === MAX_429_RETRIES) return { status: "error", errorMessage: "rate limited after max retries" };
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_ON_429_MS));
        continue;
      }
      if (res.status === 403 || res.status === 401) {
        return { status: "error", authError: true, errorMessage: `HTTP ${res.status} — check COURTLISTENER_API_KEY` };
      }
      if (!res.ok) {
        return { status: "error", errorMessage: `HTTP ${res.status}` };
      }

      const body = (await res.json()) as { results?: unknown[] };
      const entry = Array.isArray(body.results) ? (body.results[0] as Record<string, unknown> | undefined) : undefined;
      if (!entry) return { status: "not_scraped" };

      const docs = Array.isArray(entry.recap_documents) ? (entry.recap_documents as Record<string, unknown>[]) : [];
      const withText = docs.find((d) => typeof d.plain_text === "string" && d.plain_text.length > 0);
      if (!withText) return { status: "no_free_text" };

      return {
        status: "found",
        plainText: withText.plain_text as string,
        documentNumber: typeof withText.document_number === "string" ? withText.document_number : null,
      };
    }

    return { status: "error", errorMessage: "unreachable" };
  }

  private async executeSearch(qParam: string): Promise<SearchResult> {
    const url = `${SEARCH_URL}?type=r&q=${qParam}&court=deld,njd`;

    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      await this.throttle();
      this.lastRequestAt = Date.now();

      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Authorization: `Token ${this.apiKey}`, accept: "application/json" },
        });
      } catch (error) {
        return { status: "error", hits: [], errorMessage: `network error: ${error instanceof Error ? error.message : String(error)}` };
      }

      if (res.status === 429) {
        if (attempt === MAX_429_RETRIES) {
          return { status: "error", hits: [], httpStatus: 429, errorMessage: "rate limited after max retries" };
        }
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_ON_429_MS));
        continue;
      }

      if (res.status === 403 || res.status === 401) {
        return {
          status: "error",
          hits: [],
          httpStatus: res.status,
          authError: true,
          errorMessage: `HTTP ${res.status} — check COURTLISTENER_API_KEY`,
        };
      }

      if (!res.ok) {
        return { status: "error", hits: [], httpStatus: res.status, errorMessage: `HTTP ${res.status}` };
      }

      const body = (await res.json()) as { results?: unknown[] };
      const results = Array.isArray(body.results) ? body.results : [];

      const hits: RecapSearchHit[] = results
        .map((r) => {
          const row = r as Record<string, unknown>;
          if (typeof row.docket_id !== "number" || typeof row.caseName !== "string" || typeof row.docketNumber !== "string" || typeof row.court_id !== "string") {
            return null;
          }
          return {
            externalDocketId: row.docket_id,
            caseName: row.caseName,
            docketNumber: row.docketNumber,
            courtId: row.court_id,
            dateFiled: typeof row.dateFiled === "string" ? row.dateFiled : null,
            dateTerminated: typeof row.dateTerminated === "string" ? row.dateTerminated : null,
            assignedTo: typeof row.assignedTo === "string" && row.assignedTo.length > 0 ? row.assignedTo : null,
            natureOfSuit: typeof row.suitNature === "string" && row.suitNature.length > 0 ? row.suitNature : null,
            cause: typeof row.cause === "string" && row.cause.length > 0 ? row.cause : null,
          };
        })
        .filter((h): h is RecapSearchHit => h !== null);

      return { status: "ok", hits };
    }

    return { status: "error", hits: [], errorMessage: "unreachable" };
  }
}
