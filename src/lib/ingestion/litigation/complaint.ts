// Pure text-extraction logic for pulling product-identifying facts out of
// a Hatch-Waxman/ANDA complaint's own text — no network calls,
// independently unit-testable, same separation-of-concerns as match.ts
// (the part that holds the judgment calls, kept apart from the fetching
// code in client.ts and the DB-writing code in complaintEnrich.ts).
//
// This exists because RECAP's DOCKET metadata (party names, judge,
// dates, nature-of-suit) can never distinguish which of a company's many
// products a given case concerns — but the complaint's own text almost
// always states it explicitly. Confirmed against a real complaint already
// linked in this app's DB (CourtListener docket 73593593, Salix v.
// ScieGen, Document 1):
//
//   "...seeking approval to commercially manufacture, use, offer for
//   sale, sell, and/or import generic versions of Xifaxan® (rifaximin
//   tablets, 550 mg) prior to the expiration of U.S. Patent Nos.
//   11,779,571 ("'571 Patent"), 11,564,912 ("'912 Patent"), and
//   8,193,196 ("'196 Patent")... ScieGen notified Salix that they had
//   submitted ANDA No. 221289..."
//
// Deliberately regex-based rather than a general NLP parser — this is a
// narrow, boilerplate-heavy legal-drafting convention (every Hatch-Waxman
// complaint states these facts near-identically, for the same reason
// every FDA Paragraph IV notice letter does), the same bet the FDA PDF
// parsers in orangeBook/parse.ts and paragraphIV/parse.ts already make on
// their own source formats. Every function here returns null/empty on a
// miss rather than throwing — a complaint that doesn't match the
// convention is common (settlements, non-ANDA disputes, OCR noise) and
// must fall through to the existing company-name-only path, never crash
// the run.

export interface ComplaintIdentifiers {
  /** Digits-only, e.g. "11779571" — comma/period formatting stripped so callers can match directly against Patent.patentNumber. */
  patentNumbers: string[];
  brandName: string | null;
  /** As stated in the complaint, e.g. "550 mg" — not yet normalized to Drug.strength's "550MG" format; callers normalize at match time. */
  strength: string | null;
  andaNumber: string | null;
}

// Every U.S. utility patent number is 1-2 digits, then two more 3-digit
// groups, comma-separated as printed (e.g. "11,779,571") — reissue
// patents ("RE12,345") and design patents ("D123,456") are deliberately
// NOT matched here, since neither can be a Hatch-Waxman patent-in-suit
// covering a small-molecule drug in the shape this schema models.
const PATENT_NUMBER_RE = /\b(\d{1,2}(?:,\d{3}){2})\b/g;

// Scoped to a window after "U.S. Patent No(s)." rather than scanning the
// whole document — a complaint's later sections (certificates of service,
// exhibit lists, prior litigation history) often cite unrelated patent
// numbers, and casting too wide a net would silently attribute a case to
// the wrong patent. 400 chars comfortably covers the real example above
// (a 3-patent list plus parentheticals) without reaching into the next
// paragraph.
function extractPatentNumbers(text: string): string[] {
  const numbers = new Set<string>();
  const blockRe = /U\.S\.\s*Patent\s*Nos?\.?\s*([^.]{0,400})/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(text))) {
    const block = blockMatch[1];
    let numMatch: RegExpExecArray | null;
    PATENT_NUMBER_RE.lastIndex = 0;
    while ((numMatch = PATENT_NUMBER_RE.exec(block))) {
      numbers.add(numMatch[1].replace(/,/g, ""));
    }
  }
  return [...numbers];
}

// Matches the "generic version(s) of <Brand>® (<ingredient>, <strength>)"
// phrasing confirmed live — this exact wording (or "generic version of")
// is standard Hatch-Waxman complaint boilerplate identifying the
// reference listed drug (RLD) being challenged, distinct from any generic
// company/product names mentioned elsewhere in the same complaint.
const BRAND_NAME_RE = /generic versions? of\s+([A-Z][A-Za-z0-9''-]*(?:\s+[A-Z][A-Za-z0-9''-]*)?)\s*®?\s*\(([^,)]+),\s*([^)]+)\)/i;

function extractBrandNameAndStrength(text: string): { brandName: string | null; strength: string | null } {
  const m = BRAND_NAME_RE.exec(text);
  if (!m) return { brandName: null, strength: null };
  return { brandName: m[1].trim(), strength: m[3].trim() };
}

// Only the first "ANDA No. <digits>" mention — a complaint against
// multiple defendants can cite several, and picking a single one to
// store for audit/traceability (not used for matching — see match
// priority in complaintEnrich.ts) is a deliberate, documented limitation,
// not a silent bug.
const ANDA_NUMBER_RE = /\bANDA\s*No\.?\s*(\d+)/i;

function extractAndaNumber(text: string): string | null {
  const m = ANDA_NUMBER_RE.exec(text);
  return m ? m[1] : null;
}

export function extractComplaintIdentifiers(text: string): ComplaintIdentifiers {
  const { brandName, strength } = extractBrandNameAndStrength(text);
  return {
    patentNumbers: extractPatentNumbers(text),
    brandName,
    strength,
    andaNumber: extractAndaNumber(text),
  };
}
