// Client for SEC EDGAR's full-text search API and raw filing fetch — the
// two calls the settlements pipeline needs. Confirmed live against a real
// case (Xifaxan / Bausch Health / Actavis, 2026-08-21) before this module
// was written — see scripts/poc-edgar-settlement.ts for that proof.
//
// EDGAR's fair-access policy requires a descriptive User-Agent identifying
// the requester (no API key) and asks for no more than ~10 req/s; this
// client does a handful of sequential calls per drug (one search + up to
// a few filing fetches), nowhere near that ceiling, so no throttling is
// implemented here the way pta/client.ts and litigation/client.ts need
// for their much stricter per-key limits.

const FTS_URL = "https://efts.sec.gov/LATEST/search-index";
const USER_AGENT_URL = "Patent Horizon (research use) contact@patenthorizon.example";

export interface EdgarHit {
  id: string; // "<accession>:<filename>"
  ciks: string[];
  displayNames: string[];
  form: string;
  fileDate: string; // YYYY-MM-DD
}

export interface EdgarSearchResult {
  status: "ok" | "error";
  hits: EdgarHit[];
  errorMessage?: string;
}

export async function searchEdgarFullText(query: string, forms: string): Promise<EdgarSearchResult> {
  const url = `${FTS_URL}?q=${encodeURIComponent(query)}&forms=${encodeURIComponent(forms)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT_URL, accept: "application/json" } });
  } catch (error) {
    return { status: "error", hits: [], errorMessage: `network error: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!res.ok) {
    return { status: "error", hits: [], errorMessage: `EDGAR full-text search HTTP ${res.status}` };
  }
  const body = await res.json();
  const rawHits: unknown[] = Array.isArray(body?.hits?.hits) ? body.hits.hits : [];
  const hits: EdgarHit[] = rawHits.map((h) => {
    const hit = h as Record<string, unknown>;
    const source = hit._source as Record<string, unknown>;
    return {
      id: hit._id as string,
      ciks: (source.ciks as string[]) ?? [],
      displayNames: (source.display_names as string[]) ?? [],
      form: (source.form as string) ?? "",
      fileDate: (source.file_date as string) ?? "",
    };
  });
  return { status: "ok", hits };
}

export function edgarFilingUrl(hit: EdgarHit): string | null {
  const [accession, filename] = hit.id.split(":");
  if (!accession || !filename || hit.ciks.length === 0) return null;
  const cik = hit.ciks[0].replace(/^0+/, "");
  const accessionNoDashes = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDashes}/${filename}`;
}

export interface FilingFetchResult {
  status: "ok" | "error";
  text?: string; // HTML stripped to plain text
  errorMessage?: string;
}

export async function fetchFilingText(url: string): Promise<FilingFetchResult> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT_URL } });
  } catch (error) {
    return { status: "error", errorMessage: `network error: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!res.ok) {
    return { status: "error", errorMessage: `filing fetch HTTP ${res.status}` };
  }
  const html = await res.text();
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#174;/g, "®")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
  return { status: "ok", text };
}
