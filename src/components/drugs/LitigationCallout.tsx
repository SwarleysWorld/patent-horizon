import clsx from "clsx";
import type { DrugDetail } from "@/lib/drugs/schemas";
import { formatDate } from "@/lib/format";

type LitigationCase = DrugDetail["litigationCases"][number];

// A card rendered on the page is one "dispute" — one or more LitigationCase
// records sharing an exact matched party pair, combined here so the same
// real-world fight between two known companies doesn't render as N
// near-identical cards just because it was ingested as N separate case rows
// (e.g. dockets filed further apart than the ingestion pipeline's grouping
// window — see litigation/load.ts's findOrCreateLitigationCase). Merging is
// display-only: the underlying LitigationCase rows are untouched.
type MergedDispute = LitigationCase & { mergedCaseCount: number };

const TIER_RANK: Record<LitigationCase["matchConfidence"], number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function mergeGroup(group: LitigationCase[]): MergedDispute {
  const first = group[0];
  if (group.length === 1) return { ...first, mergedCaseCount: 1 };

  const dockets = group
    .flatMap((c) => c.dockets)
    .sort((a, b) => (a.filingDate ?? "9999") < (b.filingDate ?? "9999") ? -1 : 1);

  const outcomes = new Set(group.map((c) => c.outcome));
  const outcome = outcomes.has("ONGOING") ? "ONGOING" : outcomes.size === 1 ? first.outcome : "UNCLEAR";
  const outcomeNote = outcomes.size > 1
    ? `Combined from ${group.length} linked case records with differing recorded outcomes — see individual docket dates above.`
    : first.outcomeNote;

  const matchConfidence = group.reduce<LitigationCase["matchConfidence"]>(
    (best, c) => (TIER_RANK[c.matchConfidence] > TIER_RANK[best] ? c.matchConfidence : best),
    first.matchConfidence,
  );
  const notes = [...new Set(group.map((c) => c.matchNote).filter((n): n is string => !!n))];
  const matchNote = `Consolidated from ${group.length} linked case records between the same two parties. ${notes.join(" ")}`.trim();

  return {
    ...first,
    outcome,
    outcomeNote,
    matchConfidence,
    matchNote,
    dockets,
    manuallyEntered: group.some((c) => c.manuallyEntered),
    mergedCaseCount: group.length,
  };
}

// Groups by exact matched-company party pair only — an unmatched raw name
// isn't a reliable enough identity signal to merge on, so each such case
// stays its own group (keyed by id).
function groupByParty(cases: LitigationCase[]): MergedDispute[] {
  const groups = new Map<string, LitigationCase[]>();
  for (const c of cases) {
    const key = c.plaintiffMatched && c.defendantMatched ? `${c.plaintiffName}||${c.defendantName}` : c.id;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()].map(mergeGroup);
}

const OUTCOME_LABELS: Record<LitigationCase["outcome"], string> = {
  ONGOING: "Ongoing",
  SETTLED: "Settled",
  DISMISSED: "Dismissed",
  RULING_FOR_PLAINTIFF: "Ruling for Plaintiff",
  RULING_FOR_DEFENDANT: "Ruling for Defendant",
  TRANSFERRED: "Transferred",
  UNCLEAR: "Outcome unclear",
};

const OUTCOME_STYLES: Record<LitigationCase["outcome"], string> = {
  ONGOING: "bg-flag-50 text-flag-700 ring-flag-600/20 dark:bg-flag-500/10 dark:text-flag-400 dark:ring-flag-500/20",
  SETTLED: "bg-statute-50 text-statute-700 ring-statute-600/20 dark:bg-statute-500/10 dark:text-statute-400 dark:ring-statute-500/20",
  DISMISSED: "bg-paper-100 text-paper-600 ring-paper-500/20 dark:bg-paper-800 dark:text-paper-400 dark:ring-paper-600/30",
  RULING_FOR_PLAINTIFF: "bg-statute-50 text-statute-700 ring-statute-600/20 dark:bg-statute-500/10 dark:text-statute-400 dark:ring-statute-500/20",
  RULING_FOR_DEFENDANT: "bg-rust-50 text-rust-700 ring-rust-600/20 dark:bg-rust-500/10 dark:text-rust-400 dark:ring-rust-500/20",
  TRANSFERRED: "bg-ledger-50 text-ledger-700 ring-ledger-600/20 dark:bg-ledger-500/10 dark:text-ledger-400 dark:ring-ledger-500/20",
  UNCLEAR: "bg-paper-100 text-paper-500 ring-paper-500/20 dark:bg-paper-800 dark:text-paper-400 dark:ring-paper-600/30",
};

function OutcomeBadge({ outcome }: { outcome: LitigationCase["outcome"] }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", OUTCOME_STYLES[outcome])}>
      {OUTCOME_LABELS[outcome]}
    </span>
  );
}

const CONFIDENCE_LABELS: Record<LitigationCase["matchConfidence"], string> = {
  HIGH: "High confidence match",
  MEDIUM: "Medium confidence match",
  LOW: "Match uncertain",
};

// Deliberately the most visually distinct piece on this card — this is
// the thing that must read as less certain than everything else on the
// page. A text label, not a bare color dot, and LOW renders with a
// dashed outline rather than a filled pill so it reads as provisional,
// not just another status.
function ConfidenceBadge({ tier, note }: { tier: LitigationCase["matchConfidence"]; note: string | null }) {
  return (
    <span
      title={note ?? undefined}
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

const COURT_LABELS: Record<LitigationCase["dockets"][number]["court"], string> = { DE: "D. Del.", NJ: "D.N.J." };

function DisputeCard({ dispute }: { dispute: MergedDispute }) {
  return (
    <div className="rounded-lg border border-paper-200 p-4 dark:border-paper-800">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-paper-900 dark:text-paper-50">
        <span>
          {dispute.plaintiffName}
          {!dispute.plaintiffMatched && <span className="ml-1 font-normal text-paper-400">(unmatched name)</span>}
        </span>
        <span className="font-normal text-paper-400">v.</span>
        <span>
          {dispute.defendantName}
          {!dispute.defendantMatched && <span className="ml-1 font-normal text-paper-400">(unmatched name)</span>}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <OutcomeBadge outcome={dispute.outcome} />
        <ConfidenceBadge tier={dispute.matchConfidence} note={dispute.matchNote} />
        {dispute.mergedCaseCount > 1 && (
          <span
            className="rounded bg-paper-100 px-1.5 py-0.5 text-[10px] font-medium text-paper-600 dark:bg-paper-800 dark:text-paper-400"
            title="Multiple linked case records for the same two parties, consolidated into one card"
          >
            {dispute.mergedCaseCount} linked records
          </span>
        )}
        {dispute.manuallyEntered && (
          <span
            className="rounded bg-ledger-50 px-1.5 py-0.5 text-[10px] font-medium text-ledger-700 dark:bg-ledger-500/10 dark:text-ledger-400"
            title="Entered manually by an Analyst, not from the automated RECAP pipeline — see /data's audit log"
          >
            Manual
          </span>
        )}
      </div>
      {dispute.outcomeNote && <p className="mt-1.5 text-xs text-paper-500 dark:text-paper-400">{dispute.outcomeNote}</p>}

      <div className="mt-3 flex flex-col gap-1.5">
        {dispute.dockets.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-paper-600 dark:text-paper-400">
            <span className="inline-flex items-center rounded bg-paper-100 px-1.5 py-0.5 font-medium text-paper-600 dark:bg-paper-800 dark:text-paper-400">
              {COURT_LABELS[d.court]}
            </span>
            <span className="font-mono">{d.docketNumber}</span>
            {d.filingDate && <span>filed {formatDate(d.filingDate)}</span>}
            {d.dateTerminated && <span>terminated {formatDate(d.dateTerminated)}</span>}
            {d.judge && <span>Judge {d.judge}</span>}
          </div>
        ))}
      </div>

      {dispute.matchNote && <p className="mt-3 text-xs text-paper-400 dark:text-paper-600">{dispute.matchNote}</p>}
    </div>
  );
}

// Collapsed by default — the individual cases inside are all
// company-name-only matches (MEDIUM/LOW), never confirmed to concern this
// specific product. Full DisputeCards, just tucked behind a disclosure so
// they don't bury the confirmed section above.
function LowConfidenceDisclosure({ cases, companyName }: { cases: LitigationCase[]; companyName: string }) {
  if (cases.length === 0) return null;
  const disputes = groupByParty(cases);

  return (
    <details className="group rounded-lg border border-paper-200 p-4 dark:border-paper-800">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-paper-600 marker:content-none dark:text-paper-400">
        <span className="text-paper-400 transition-transform group-open:rotate-90 dark:text-paper-500">▸</span>
        <span>
          {cases.length} litigation record{cases.length === 1 ? "" : "s"} exist{cases.length === 1 ? "s" : ""} for{" "}
          {companyName}, but none could be confidently linked to this specific product.
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {disputes.map((d) => (
          <DisputeCard key={d.id} dispute={d} />
        ))}
      </div>
    </details>
  );
}

export function LitigationCallout({
  cases,
  companyName,
  productName,
}: {
  cases: DrugDetail["litigationCases"];
  companyName: string;
  productName: string;
}) {
  if (cases.length === 0) return null;

  const confirmed = groupByParty(cases.filter((c) => c.matchConfidence === "HIGH"));
  const unconfirmed = cases.filter((c) => c.matchConfidence !== "HIGH");

  return (
    <section id="litigation">
      <h2 className="mb-2 text-sm font-semibold text-paper-900 dark:text-paper-50">
        Litigation <span className="font-normal text-paper-400">(CourtListener RECAP — D. Del. / D.N.J. only)</span>
      </h2>
      {confirmed.length === 0 && (
        <p className="mb-3 text-sm text-paper-600 dark:text-paper-400">
          No confirmed product-specific litigation found for {productName}.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {confirmed.map((d) => (
          <DisputeCard key={d.id} dispute={d} />
        ))}
        <LowConfidenceDisclosure cases={unconfirmed} companyName={companyName} />
      </div>
      <p className="mt-2 text-xs text-paper-400 dark:text-paper-600">
        Sourced from CourtListener&apos;s free RECAP archive and linked to this product by company-name matching, not
        an exact filing ID — treat party attribution and product linkage as best-effort, especially where marked
        lower-confidence above. Scoped to the District of Delaware and District of New Jersey only; litigation filed
        elsewhere isn&apos;t tracked.
      </p>
    </section>
  );
}
