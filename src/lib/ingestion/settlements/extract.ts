// Pure text-extraction logic for the settlements pipeline — no network
// calls, independently unit-testable, same separation-of-concerns as
// litigation/match.ts (the part that holds all the judgment calls, kept
// apart from client.ts/load.ts).
//
// Targets a specific template pharma companies commonly use in 10-K/10-Q
// Legal Proceedings sections: one heading per counterparty dispute,
// "<Drug>[®] ... Patent Litigation (<Counterparty>) - <narrative>",
// repeated for every counterparty in the same filing. Confirmed real
// against Bausch Health's own Xifaxan disclosures (see
// scripts/poc-edgar-settlement.ts) — critically, the SAME heading
// template is used for litigation that is STILL ONGOING (e.g. Xifaxan's
// Sandoz dispute) as for one that's SETTLED (Actavis) within the same
// filing, so a heading match alone is not evidence of a settlement —
// only a block that also contains settlement-narrative language counts.

export type SettlementExtractionConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface ExtractedSettlement {
  counterpartyNameRaw: string;
  licensedEntryDate: string | null; // YYYY-MM-DD
  earlierCircumstancesNoted: boolean;
  settlementAnnouncedDate: string | null; // YYYY-MM-DD
  extractedExcerpt: string;
  confidence: SettlementExtractionConfidence;
  note: string;
}

const SETTLEMENT_LANGUAGE_RE = /reached an agreement|settlement agreement|resolved the (?:existing )?litigation|entered into .*?agreement/i;
const MONTH_DATE_RE = "[A-Z][a-z]+ \\d{1,2}, \\d{4}";

function parseMonthDate(s: string): string | null {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Splits filing text into one block per "<Drug> ... Patent Litigation
// (<Counterparty>) - ..." heading. A block runs until the next such
// heading (for ANY counterparty, since headings for the same drug repeat
// throughout a Legal Proceedings section) or a hard length cap, whichever
// comes first — long enough to hold the settlement narrative, short
// enough not to swallow the next unrelated section if the next heading
// doesn't fire for some reason.
const MAX_BLOCK_CHARS = 2500;

function splitByHeading(text: string, drugName: string): { counterparty: string; block: string }[] {
  const headingRe = new RegExp(`${escapeRegExp(drugName)}\\s*®?\\s*[\\w\\s]{0,20}?Patent Litigation\\s*\\(([^)]+)\\)\\s*-\\s*`, "gi");
  const matches = [...text.matchAll(headingRe)];
  return matches.map((m, i) => {
    const start = m.index! + m[0].length;
    const nextStart = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const end = Math.min(nextStart, start + MAX_BLOCK_CHARS);
    return { counterparty: m[1].replace(/^"|"$/g, "").trim(), block: text.slice(start, end).trim() };
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// One filing can disclose settlements with several counterparties (and
// mention others still in active litigation) — returns one entry per
// counterparty block that reads as an actual settlement, skipping blocks
// that are still describing ongoing/unresolved litigation.
export function extractSettlementsFromFiling(text: string, drugName: string): ExtractedSettlement[] {
  const blocks = splitByHeading(text, drugName);
  const results: ExtractedSettlement[] = [];

  for (const { counterparty, block } of blocks) {
    if (!SETTLEMENT_LANGUAGE_RE.test(block)) continue; // still ongoing / no resolution disclosed — not a settlement

    const announcedMatch = new RegExp(`(${MONTH_DATE_RE}),?\\s+(?:we|the Company)\\s+announced`, "i").exec(block);
    const settlementAnnouncedDate = announcedMatch ? parseMonthDate(announcedMatch[1]) : null;

    // "beginning <date> (or earlier under certain circumstances)" is the
    // specific phrasing this template uses for a licensed generic-entry
    // date — the fact this whole pipeline exists to surface.
    const licenseMatch = new RegExp(`beginning\\s+(${MONTH_DATE_RE})`, "i").exec(block);
    const licensedEntryDate = licenseMatch ? parseMonthDate(licenseMatch[1]) : null;
    const earlierCircumstancesNoted = /or earlier under certain circumstances/i.test(block);

    const excerpt = block.slice(0, 1500).trim();

    let confidence: SettlementExtractionConfidence;
    let note: string;
    if (licensedEntryDate) {
      confidence = "HIGH";
      note = `Matched this filing's own "Patent Litigation (${counterparty})" settlement template, including an explicit licensed generic-entry date ("beginning ${licenseMatch![1]}").`;
    } else if (settlementAnnouncedDate) {
      confidence = "MEDIUM";
      note = `Matched a settlement narrative for "${counterparty}" (announced ${announcedMatch![1]}), but no explicit licensed generic-entry date could be extracted from this filing's phrasing — verify the terms directly.`;
    } else {
      confidence = "LOW";
      note = `Matched settlement-narrative language near a "${counterparty}" heading, but neither an announcement date nor a licensed-entry date could be confidently extracted — this is a weak signal, verify directly against the filing.`;
    }

    results.push({
      counterpartyNameRaw: counterparty,
      licensedEntryDate,
      earlierCircumstancesNoted,
      settlementAnnouncedDate,
      extractedExcerpt: excerpt,
      confidence,
      note,
    });
  }

  return results;
}
