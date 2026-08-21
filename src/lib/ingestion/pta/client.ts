// Client for the USPTO Open Data Portal (ODP) Patent File Wrapper "Search"
// endpoint, used to look up Patent Term Adjustment data by patent number.
// Docs: https://data.uspto.gov/apis/patent-file-wrapper
//
// Rate limits (per ODP's own "API rate limits" page) are strict: burst = 1
// (no concurrent requests per API key, ever) and a documented preference for
// serialized calls with graceful, non-aggressive 429 handling. This client
// is deliberately built around one in-flight request at a time.

const SEARCH_URL = "https://api.uspto.gov/api/v1/patent/applications/search";
const MIN_DELAY_MS = 350; // well under ODP's stated 4-15 req/s ceiling
const MAX_429_RETRIES = 5;
const BACKOFF_ON_429_MS = 5_000; // ODP explicitly discourages faster retries

export interface PtaLookupResult {
  status: "found" | "not_found" | "error";
  applicationNumberText?: string;
  filingDate?: string; // YYYY-MM-DD as returned by ODP
  adjustmentTotalQuantity?: number;
  raw?: unknown;
  errorMessage?: string;
  httpStatus?: number;
  /** true only for a 403 — almost certainly a bad/missing API key, not a per-patent problem. Callers should abort the whole run rather than retry per patent. */
  authError?: boolean;
}

export class UsptoOdpClient {
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

  async lookupByPatentNumber(patentNumber: string): Promise<PtaLookupResult> {
    const url = `${SEARCH_URL}?q=applicationMetaData.patentNumber:${encodeURIComponent(patentNumber)}`;

    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      await this.throttle();
      this.lastRequestAt = Date.now();

      let res: Response;
      try {
        res = await fetch(url, {
          headers: { "x-api-key": this.apiKey, accept: "application/json" },
        });
      } catch (error) {
        return {
          status: "error",
          errorMessage: `network error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      if (res.status === 429) {
        if (attempt === MAX_429_RETRIES) {
          return { status: "error", httpStatus: 429, errorMessage: "rate limited after max retries" };
        }
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_ON_429_MS));
        continue;
      }

      if (res.status === 403) {
        return {
          status: "error",
          httpStatus: 403,
          authError: true,
          errorMessage: "403 Forbidden — check USPTO_ODP_API_KEY",
        };
      }

      if (res.status === 404) {
        // ODP's real behavior for "no record for this patent" — confirmed
        // live against known out-of-coverage patents (pre-2001 filings):
        // it returns 404, not 200 + an empty patentFileWrapperDataBag as
        // the bag.length === 0 branch below assumes. Both are the same
        // "not found" outcome; only the transport shape differs.
        return { status: "not_found" };
      }

      if (!res.ok) {
        return { status: "error", httpStatus: res.status, errorMessage: `HTTP ${res.status}` };
      }

      const body = await res.json();
      const bag: unknown[] = Array.isArray(body?.patentFileWrapperDataBag)
        ? body.patentFileWrapperDataBag
        : [];

      if (bag.length === 0) {
        return { status: "not_found", raw: body };
      }

      const entry =
        (bag as Record<string, unknown>[]).find((b) => b.patentTermAdjustmentData) ??
        (bag[0] as Record<string, unknown>);
      const pta = entry.patentTermAdjustmentData as Record<string, unknown> | undefined;
      const appMeta = entry.applicationMetaData as Record<string, unknown> | undefined;

      if (!pta || typeof pta.adjustmentTotalQuantity !== "number") {
        // This dataset only covers applications filed after Jan 1, 2001 —
        // older patents legitimately have no PTA record here.
        return { status: "not_found", raw: body };
      }

      return {
        status: "found",
        applicationNumberText: entry.applicationNumberText as string | undefined,
        filingDate: appMeta?.filingDate as string | undefined,
        adjustmentTotalQuantity: pta.adjustmentTotalQuantity,
        raw: body,
      };
    }

    return { status: "error", errorMessage: "unreachable" };
  }
}
