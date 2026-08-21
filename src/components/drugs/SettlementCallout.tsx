import clsx from "clsx";
import type { DrugDetail } from "@/lib/drugs/schemas";
import { formatDate, cleanEdgarFilerName } from "@/lib/format";

type Settlement = DrugDetail["settlementDisclosures"][number];

const CONFIDENCE_LABELS: Record<Settlement["extractionConfidence"], string> = {
  HIGH: "High confidence extraction",
  MEDIUM: "Medium confidence extraction",
  LOW: "Extraction uncertain",
};

// Same visual register as LitigationCallout's ConfidenceBadge — this is
// the WEAKEST-confidence source on the whole page (pattern-matched from
// filing prose, not even a resolved company name), so it must read as
// less certain than everything else here, including the RECAP litigation
// section above it.
function ConfidenceBadge({ tier, note }: { tier: Settlement["extractionConfidence"]; note: string }) {
  return (
    <span
      title={note}
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        tier === "HIGH" && "bg-statute-50 text-statute-700 ring-1 ring-inset ring-statute-600/20 dark:bg-statute-500/10 dark:text-statute-400 dark:ring-statute-500/20",
        tier === "MEDIUM" && "bg-flag-50 text-flag-700 ring-1 ring-inset ring-flag-600/20 dark:bg-flag-500/10 dark:text-flag-400 dark:ring-flag-500/20",
        tier === "LOW" && "text-paper-500 ring-1 ring-dashed ring-paper-400 dark:text-paper-500 dark:ring-paper-600",
      )}
    >
      {CONFIDENCE_LABELS[tier]}
    </span>
  );
}

// Groups by counterparty — belt-and-suspenders against the same drift the
// ingestion pipeline already dedupes against within one run (see
// settlements/load.ts): the same settlement gets re-disclosed
// near-verbatim across many consecutive filings, and a slow trickle of
// one extra row every staleness window is possible over months even with
// that in-run dedupe. Keeps the most recently-filed disclosure per
// counterparty, since a later filing is the more current statement of
// the same terms.
function dedupeByCounterparty(settlements: Settlement[]): Settlement[] {
  const byCounterparty = new Map<string, Settlement>();
  for (const s of settlements) {
    const key = s.counterpartyNameRaw.toLowerCase();
    const existing = byCounterparty.get(key);
    if (!existing || s.sourceFileDate > existing.sourceFileDate) byCounterparty.set(key, s);
  }
  return [...byCounterparty.values()];
}

function SettlementCard({ settlement }: { settlement: Settlement }) {
  return (
    <div className="rounded-lg border border-paper-200 p-4 dark:border-paper-800">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-paper-900 dark:text-paper-50">
        <span>Settlement with {settlement.counterpartyNameRaw}</span>
        {!settlement.counterpartyMatched && <span className="font-normal text-paper-400">(unmatched name)</span>}
      </div>
      <p className="mt-1 text-xs text-paper-500 dark:text-paper-400">
        Disclosed by {cleanEdgarFilerName(settlement.filingCompanyNameRaw)} in its {settlement.sourceForm} filed {formatDate(settlement.sourceFileDate)}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <ConfidenceBadge tier={settlement.extractionConfidence} note={settlement.extractionNote} />
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {settlement.licensedEntryDate && (
          <div>
            <dt className="text-xs text-paper-500 dark:text-paper-400">Licensed generic-entry date</dt>
            <dd className="font-medium font-mono tabular-nums text-paper-900 dark:text-paper-50">
              {formatDate(settlement.licensedEntryDate)}
              {settlement.earlierCircumstancesNoted && (
                <span className="ml-1 font-sans text-xs font-normal text-paper-500 dark:text-paper-400">
                  (or earlier under certain circumstances)
                </span>
              )}
            </dd>
          </div>
        )}
        {settlement.settlementAnnouncedDate && (
          <div>
            <dt className="text-xs text-paper-500 dark:text-paper-400">Settlement announced</dt>
            <dd className="font-mono tabular-nums text-paper-700 dark:text-paper-300">{formatDate(settlement.settlementAnnouncedDate)}</dd>
          </div>
        )}
      </dl>

      <p className="mt-3 text-xs text-paper-400 dark:text-paper-600">{settlement.extractionNote}</p>

      <a
        href={settlement.sourceFilingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block text-xs font-medium text-ledger-700 hover:underline dark:text-ledger-400"
      >
        View source filing on SEC EDGAR ↗
      </a>
    </div>
  );
}

export function SettlementCallout({ settlements }: { settlements: DrugDetail["settlementDisclosures"] }) {
  if (settlements.length === 0) return null;
  const deduped = dedupeByCounterparty(settlements);

  return (
    <section id="settlements">
      <h2 className="mb-2 text-sm font-semibold text-paper-900 dark:text-paper-50">
        Settlement disclosures <span className="font-normal text-paper-400">(SEC EDGAR — 10-K/10-Q filings)</span>
      </h2>
      <div className="flex flex-col gap-3">
        {deduped.map((s) => (
          <SettlementCard key={s.id} settlement={s} />
        ))}
      </div>
      <p className="mt-2 text-xs text-paper-400 dark:text-paper-600">
        Sourced from the filing company&apos;s own SEC disclosures, not a court record — a settlement can
        resolve litigation without ever producing a docket entry that names its actual terms. Extracted from
        filing text via pattern-matching, not an exact-ID match; treat every date here as provisional until
        verified against the linked primary source.
      </p>
    </section>
  );
}
