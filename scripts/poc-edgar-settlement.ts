import "dotenv/config";

// Feasibility POC for Part 2 of the PTA/EDGAR investigation — NOT wired
// into the app or the ingestion orchestrator. Confirms two things end to
// end against one real, known case (Xifaxan / Bausch Health / Actavis)
// before any broader implementation is attempted:
//
//   1. SEC EDGAR's full-text search API is queryable by company + drug
//      name and returns relevant 10-K/10-Q filings.
//   2. A real settlement disclosure inside one of those filings can be
//      located and its key facts (counterparty, licensed generic-entry
//      date) extracted with a simple, targeted text pattern.
//
// EDGAR fair-access policy requires a descriptive User-Agent with contact
// info and caps at ~10 req/s — this script makes a handful of sequential
// calls, well under that.

const FTS_URL = "https://efts.sec.gov/LATEST/search-index";
const USER_AGENT = "PatentHorizon Research contact@patenthorizon.example";

interface EdgarHit {
  _id: string; // "<accession>:<filename>"
  _source: {
    ciks: string[];
    display_names: string[];
    form: string;
    file_date: string;
    root_forms: string[];
  };
}

async function searchEdgar(query: string, forms: string): Promise<EdgarHit[]> {
  const url = `${FTS_URL}?q=${encodeURIComponent(query)}&forms=${encodeURIComponent(forms)}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, accept: "application/json" } });
  if (!res.ok) throw new Error(`EDGAR full-text search HTTP ${res.status}`);
  const body = await res.json();
  return body.hits?.hits ?? [];
}

function filingUrl(hit: EdgarHit): string {
  const [accession, filename] = hit._id.split(":");
  const cik = hit._source.ciks[0].replace(/^0+/, "");
  const accessionNoDashes = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDashes}/${filename}`;
}

async function fetchFilingText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`filing fetch HTTP ${res.status}`);
  const html = await res.text();
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#174;/g, "®")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

export interface ExtractedSettlement {
  drugName: string;
  counterparty: string;
  licensedEntryDate: string | null;
  earlierCircumstancesNoted: boolean;
  settlementAnnouncedDate: string | null;
  sourceFilingUrl: string;
  sourceForm: string;
  sourceFileDate: string;
  extractedExcerpt: string;
  caveat: string;
}

// Deliberately narrow: looks for the specific template pharma companies
// commonly use in Legal Proceedings / Commitments & Contingencies
// sections — "<Drug>[®] ... Patent Litigation (<Party>) - ... " followed
// by a settlement narrative. This is a proof of concept pattern-match,
// not a general-purpose settlement parser — see the caveat field on the
// result, and the write-up's "Limitations" section.
function extractSettlement(text: string, drugName: string, filingUrl: string, form: string, fileDate: string): ExtractedSettlement | null {
  const headingRe = new RegExp(`${drugName}\\s*®?\\s*[\\w\\s]*?Patent Litigation\\s*\\(([^)]+)\\)\\s*-\\s*(.*?)(?=${drugName}\\s*®?\\s*[\\w\\s]*?Patent Litigation\\s*\\(|$)`, "i");
  const match = headingRe.exec(text);
  if (!match) return null;

  const [, counterparty, body] = match;
  const excerpt = body.slice(0, 1500).trim();

  const settledMatch = /([A-Z][a-z]+ \d{1,2}, \d{4}),?\s+(?:we|the Company)\s+announced/i.exec(excerpt);
  // "beginning <date> (or earlier under certain circumstances)" is the
  // specific phrase this template uses for the licensed generic-entry date.
  const licenseDateMatch = /beginning\s+([A-Z][a-z]+ \d{1,2}, \d{4})/i.exec(excerpt);
  const earlierCircumstancesNoted = /or earlier under certain circumstances/i.test(excerpt);

  return {
    drugName,
    counterparty: counterparty.replace(/^"|"$/g, "").trim(),
    licensedEntryDate: licenseDateMatch?.[1] ?? null,
    earlierCircumstancesNoted,
    settlementAnnouncedDate: settledMatch?.[1] ?? null,
    sourceFilingUrl: filingUrl,
    sourceForm: form,
    sourceFileDate: fileDate,
    extractedExcerpt: excerpt,
    caveat:
      "Extracted from filing text via pattern-matching, not exact-ID matching — verify against the primary source filing before relying on this date.",
  };
}

async function findSettlement(companyQueryName: string, drugName: string): Promise<ExtractedSettlement | null> {
  const hits = await searchEdgar(`"${drugName}" "Patent Litigation"`, "10-K,10-Q");
  const companyHits = hits.filter((h) =>
    h._source.display_names.some((n) => n.toLowerCase().includes(companyQueryName.toLowerCase())),
  );
  console.log(`[poc] ${hits.length} total hits, ${companyHits.length} from "${companyQueryName}"`);

  // NOT simply most-recent-first: once litigation is old news, later
  // filings often drop or compress the paragraph entirely (confirmed live
  // — BHC's 2025/2026 filings no longer describe the 2018 Actavis
  // settlement in this template at all). Filings from the few years after
  // the announcement are where the full templated disclosure actually
  // lives, so this tries every company hit rather than assuming recency
  // helps; a real implementation would cache the first successful hit per
  // (company, drug, counterparty) rather than re-scanning every run.
  for (const hit of companyHits.slice(0, 20)) {
    const url = filingUrl(hit);
    console.log(`[poc] checking ${hit._source.form} filed ${hit._source.file_date}: ${url}`);
    const text = await fetchFilingText(url);
    const result = extractSettlement(text, drugName, url, hit._source.form, hit._source.file_date);
    if (result?.licensedEntryDate) return result;
  }
  return null;
}

async function main() {
  const [companyArg, drugArg] = process.argv.slice(2);
  const companyQueryName = companyArg ?? "Bausch Health";
  const drugName = drugArg ?? "Xifaxan";

  console.log(`[poc] searching EDGAR for "${drugName}" settlements mentioning "${companyQueryName}"...`);
  const result = await findSettlement(companyQueryName, drugName);

  console.log("");
  console.log("=== result ===");
  console.log(JSON.stringify(result, null, 2));

  if (!result) {
    console.log("\nNo settlement extracted.");
    process.exitCode = 1;
    return;
  }

  console.log(`\nDrug: ${result.drugName}`);
  console.log(`Counterparty: ${result.counterparty}`);
  console.log(`Licensed generic-entry date: ${result.licensedEntryDate}${result.earlierCircumstancesNoted ? " (or earlier under certain circumstances)" : ""}`);
  console.log(`Settlement announced: ${result.settlementAnnouncedDate ?? "not extracted"}`);
  console.log(`Source: ${result.sourceForm} filed ${result.sourceFileDate} — ${result.sourceFilingUrl}`);
}

main().catch((error) => {
  console.error("[poc] fatal error:", error);
  process.exitCode = 1;
});
