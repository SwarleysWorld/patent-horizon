// The DB-writing half of the settlements pipeline. Calls into client.ts
// for the EDGAR calls and extract.ts for the actual judgment call (is
// this block a real settlement); this file only turns those results into
// upserts.

import { prisma } from "@/lib/prisma";
import { searchEdgarFullText, edgarFilingUrl, fetchFilingText } from "./client";
import { extractSettlementsFromFiling } from "./extract";
import { matchCompanyByName, type CompanyRef } from "../litigation/match";
import type { RowIssue } from "./types";

export interface LoadResultForBrand {
  filingsScanned: number;
  settlementsExtracted: number;
  drugLinksCreated: number;
}

// Confirmed live (scripts/poc-edgar-settlement.ts): companies commonly
// drop an old, resolved litigation's disclosure from their MOST RECENT
// filings once it's no longer material — the full narrative (including
// the licensed-entry date this pipeline exists to find) tends to live in
// filings from the few years right after the settlement, not the latest
// one. Checking a batch of hits rather than assuming recency wins is
// deliberate, not a fallback.
const MAX_FILINGS_TO_CHECK = 20;

export async function loadSettlementsForBrand(
  brandName: string,
  drugIds: string[], // every Drug row (strength/product variant) sharing this brand name
  companiesByNormalizedName: Map<string, CompanyRef[]>,
  opts: { sourceId: string; verifiedAt: Date; issues: RowIssue[] },
): Promise<LoadResultForBrand> {
  const { sourceId, verifiedAt, issues } = opts;
  let filingsScanned = 0;
  let settlementsExtracted = 0;
  let drugLinksCreated = 0;

  const searchResult = await searchEdgarFullText(`"${brandName}" "Patent Litigation"`, "10-K,10-Q");
  if (searchResult.status === "error") {
    issues.push({ file: "edgar-search", line: -1, reason: `search failed: ${searchResult.errorMessage}`, raw: brandName });
    return { filingsScanned, settlementsExtracted, drugLinksCreated };
  }

  // One counterparty per run, not one per filing — the same settlement
  // gets re-disclosed near-verbatim across many consecutive filings once
  // it exists, and without this a single run would create one
  // near-duplicate SettlementDisclosure row per filing that mentions it
  // (up to MAX_FILINGS_TO_CHECK of them). The first filing (in EDGAR's
  // relevance-ranked order) that yields a given counterparty wins for
  // this run; SettlementCallout also groups by counterparty for defense
  // in depth against the slower cross-run version of the same drift.
  const counterpartiesHandledThisRun = new Set<string>();

  for (const hit of searchResult.hits.slice(0, MAX_FILINGS_TO_CHECK)) {
    const url = edgarFilingUrl(hit);
    if (!url) continue;

    const filingResult = await fetchFilingText(url);
    filingsScanned++;
    if (filingResult.status === "error" || !filingResult.text) {
      issues.push({ file: "edgar-filing-fetch", line: -1, reason: `fetch failed: ${filingResult.errorMessage ?? "no text"}`, raw: url });
      continue;
    }

    const extracted = extractSettlementsFromFiling(filingResult.text, brandName);
    for (const s of extracted) {
      const dedupeKey = s.counterpartyNameRaw.toLowerCase();
      if (counterpartiesHandledThisRun.has(dedupeKey)) continue;
      counterpartiesHandledThisRun.add(dedupeKey);

      const counterpartyMatch = matchCompanyByName(s.counterpartyNameRaw, companiesByNormalizedName);

      const disclosure = await prisma.settlementDisclosure.upsert({
        where: {
          sourceFilingUrl_drugNameRaw_counterpartyNameRaw: {
            sourceFilingUrl: url,
            drugNameRaw: brandName,
            counterpartyNameRaw: s.counterpartyNameRaw,
          },
        },
        update: {
          counterpartyCompanyId: counterpartyMatch.company?.id ?? null,
          filingCompanyNameRaw: hit.displayNames[0] ?? "",
          settlementAnnouncedDate: s.settlementAnnouncedDate ? new Date(s.settlementAnnouncedDate) : null,
          licensedEntryDate: s.licensedEntryDate ? new Date(s.licensedEntryDate) : null,
          earlierCircumstancesNoted: s.earlierCircumstancesNoted,
          sourceForm: hit.form,
          sourceFileDate: new Date(hit.fileDate),
          extractedExcerpt: s.extractedExcerpt,
          extractionConfidence: s.confidence,
          extractionNote: s.note,
        },
        create: {
          drugNameRaw: brandName,
          counterpartyNameRaw: s.counterpartyNameRaw,
          counterpartyCompanyId: counterpartyMatch.company?.id ?? null,
          filingCompanyNameRaw: hit.displayNames[0] ?? "",
          settlementAnnouncedDate: s.settlementAnnouncedDate ? new Date(s.settlementAnnouncedDate) : null,
          licensedEntryDate: s.licensedEntryDate ? new Date(s.licensedEntryDate) : null,
          earlierCircumstancesNoted: s.earlierCircumstancesNoted,
          sourceForm: hit.form,
          sourceFileDate: new Date(hit.fileDate),
          sourceFilingUrl: url,
          extractedExcerpt: s.extractedExcerpt,
          extractionConfidence: s.confidence,
          extractionNote: s.note,
        },
      });
      settlementsExtracted++;

      // Additive only (createMany + skipDuplicates), same reasoning as
      // litigation/load.ts's candidateDrugIds linking — never wipe
      // existing links before re-adding.
      const linkResult = await prisma.settlementDisclosureDrug.createMany({
        data: drugIds.map((drugId) => ({ settlementDisclosureId: disclosure.id, drugId })),
        skipDuplicates: true,
      });
      drugLinksCreated += linkResult.count;

      await prisma.ingestionRecord.create({
        data: {
          sourceId,
          settlementDisclosureId: disclosure.id,
          verifiedAt,
          externalRef: url,
          changeNote: `${s.confidence} confidence — ${s.note}`,
        },
      });
    }
  }

  return { filingsScanned, settlementsExtracted, drugLinksCreated };
}
