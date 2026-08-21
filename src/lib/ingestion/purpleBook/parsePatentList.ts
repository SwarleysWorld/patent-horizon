import type { ParsedBiologicPatent, RowIssue } from "./types";

// The Purple Book's disclosed-patent list (mandated by the Biological
// Product Patent Transparency section of the Consolidated Appropriations
// Act of 2021) has NO downloadable CSV/XLSX the way the product list
// does — confirmed by checking the actual Purple Book downloads page.
// The only place this data exists is the server-rendered HTML table at
// /patent-list, which — also confirmed directly — contains all rows
// (424 as of this writing) in the raw page HTML on a plain GET; the page's
// DataTables widget loads from that same server-rendered table and then
// paginates/re-renders client-side, it doesn't fetch a separate JSON API.
// Scraping HTML is inherently more fragile than a real data file (a page
// redesign could break this with no warning), so this is isolated in its
// own module: a parse failure here should never take down product
// ingestion, which is the far more valuable and comprehensive half of
// Purple Book. See README for why patent coverage itself is sparse
// regardless (only ~2% of BLAs have any disclosed patent at all — that's
// a real BPCIA-transparency-scope limitation, not a scraping gap).
export const PATENT_LIST_URL = "https://purplebooksearch.fda.gov/patent-list";

// FDA's WAF blocks requests without a browser-like User-Agent (returns a
// 200 "FDA Apology" redirect page instead of an error status, so a naive
// caller could easily mistake it for success) — confirmed directly: a
// plain `fetch`/`curl` with no UA gets blocked, the same request with a
// standard browser UA succeeds.
const BROWSER_LIKE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "text/html",
};

export async function fetchPatentListHtml(url: string = PATENT_LIST_URL, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { headers: BROWSER_LIKE_HEADERS, signal });
  if (!res.ok) {
    throw new Error(`failed to download Purple Book patent list: HTTP ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  if (html.includes("FDA Apology") || html.includes("abuse-detection-apology")) {
    throw new Error("Purple Book patent list request was blocked (WAF apology page) — try again, or check if the User-Agent needs updating");
  }
  return html;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();
}

function parsePatentListDate(raw: string): Date | null {
  // "January 4, 2031" — same long-month-name format as one of the two
  // product-CSV formats, and the same timezone caveat as
  // parseProducts.ts's parsePurpleBookDate: this string has no explicit
  // timezone, so a plain `new Date(...)` parses it in the server's LOCAL
  // timezone, which would make ingestion produce a different UTC instant
  // depending on where it runs. Re-anchor to UTC midnight of the same
  // calendar date local parsing produced.
  const localParse = new Date(raw.trim());
  if (Number.isNaN(localParse.getTime())) return null;
  return new Date(Date.UTC(localParse.getFullYear(), localParse.getMonth(), localParse.getDate()));
}

export function parsePatentListHtml(html: string): { patents: ParsedBiologicPatent[]; rawCount: number; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const patents: ParsedBiologicPatent[] = [];

  const tableMatch = html.match(/<table id="patentListTable"[^>]*>[\s\S]*?<\/table>/);
  if (!tableMatch) {
    issues.push({ file: "patent-list.html", line: -1, reason: "could not find <table id=\"patentListTable\"> in the fetched page — source markup may have changed", raw: "" });
    return { patents, rawCount: 0, issues };
  }

  const rowMatches = [...tableMatch[0].matchAll(/<tr valign="top"\s*>([\s\S]*?)<\/tr>/g)];

  rowMatches.forEach((match, idx) => {
    const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
    const raw = match[0].replace(/\s+/g, " ").trim().slice(0, 300);

    if (cells.length !== 6) {
      issues.push({ file: "patent-list.html", line: idx + 1, reason: `expected 6 cells, got ${cells.length}`, raw });
      return;
    }

    const [blaNumber, , , , patentNumberRaw, expirationRaw] = cells;
    const patentNumber = patentNumberRaw.replace(/,/g, "").trim(); // "8,512,983" -> "8512983", matches Orange Book's own unpunctuated patent number format

    if (!blaNumber.trim() || !patentNumber) {
      issues.push({ file: "patent-list.html", line: idx + 1, reason: "empty BLA number or patent number", raw });
      return;
    }

    const expirationDate = parsePatentListDate(expirationRaw);
    if (!expirationDate) {
      issues.push({ file: "patent-list.html", line: idx + 1, reason: `unparseable Patent Expiration Date "${expirationRaw}"`, raw });
      return;
    }

    patents.push({ blaNumber: blaNumber.trim(), patentNumber, sourceExpirationDate: expirationDate });
  });

  return { patents, rawCount: rowMatches.length, issues };
}
