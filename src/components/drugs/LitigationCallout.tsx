import clsx from "clsx";
import type { DrugDetail } from "@/lib/drugs/schemas";
import { formatDate } from "@/lib/format";

type LitigationCase = DrugDetail["litigationCases"][number];

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

function DisputeCard({ dispute }: { dispute: LitigationCase }) {
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

export function LitigationCallout({ cases }: { cases: DrugDetail["litigationCases"] }) {
  if (cases.length === 0) return null;

  return (
    <section id="litigation">
      <h2 className="mb-2 text-sm font-semibold text-paper-900 dark:text-paper-50">
        Litigation <span className="font-normal text-paper-400">(CourtListener RECAP — D. Del. / D.N.J. only)</span>
      </h2>
      <div className="flex flex-col gap-3">
        {cases.map((c) => (
          <DisputeCard key={c.id} dispute={c} />
        ))}
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
