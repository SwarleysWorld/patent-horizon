import clsx from "clsx";
import type { DrugDetail, GenericEntryEstimate } from "@/lib/drugs/schemas";
import { urgencyOf, daysFromToday, formatDate, formatRelativeDays } from "@/lib/format";
import { EntryDateCell } from "./EntryDateCell";

type Challenge = DrugDetail["genericChallenges"][number];

const BORDER_STYLES = {
  open: "border-statute-200 bg-statute-50/60 dark:border-statute-900 dark:bg-statute-500/5",
  imminent: "border-rust-200 bg-rust-50/60 dark:border-rust-900 dark:bg-rust-500/5",
  upcoming: "border-flag-200 bg-flag-50/60 dark:border-flag-900 dark:bg-flag-500/5",
  distant: "border-paper-200 bg-paper-50 dark:border-paper-800 dark:bg-paper-900/40",
  none: "border-paper-200 bg-paper-50 dark:border-paper-800 dark:bg-paper-900/40",
};

// The most current, most true fact available: among linked generic
// challenges, the earliest recorded first-commercial-marketing date that's
// already in the past. When one exists, it out-ranks the computed
// estimate as the hero — a page that leads with "coming in 30 days" while
// the evidence two sections down says "already happened in 2024" is
// contradicting itself, not just under-emphasizing a fact. Confirmed
// real, live case this was designed against: Sprycel has two challenges
// that both list the same 2024-09-03 marketing date (a genuine tie, not a
// data error) — the copy below has to handle that honestly rather than
// arbitrarily crediting one record over the other.
function findRealEntry(challenges: Challenge[]): { date: string; matches: Challenge[] } | null {
  const past = challenges.filter((c) => c.dateOfFirstCommercialMarketing != null && daysFromToday(c.dateOfFirstCommercialMarketing) < 0);
  if (past.length === 0) return null;
  const earliestDate = past.reduce((earliest, c) => (c.dateOfFirstCommercialMarketing! < earliest ? c.dateOfFirstCommercialMarketing! : earliest), past[0].dateOfFirstCommercialMarketing!);
  return { date: earliestDate, matches: past.filter((c) => c.dateOfFirstCommercialMarketing === earliestDate) };
}

function sourceSentence(matches: Challenge[]): string {
  if (matches.length > 1) {
    return `First commercial marketing recorded per FDA's Paragraph IV Certifications List — ${matches.length} separate filings confirm this date.`;
  }
  const strength = matches[0].strength;
  return `First commercial marketing recorded per FDA's Paragraph IV Certifications List, for ${strength}.`;
}

function RealEntryHero({ realEntry, estimate }: { realEntry: { date: string; matches: Challenge[] }; estimate: GenericEntryEstimate }) {
  const days = daysFromToday(realEntry.date);
  return (
    <div className={clsx("rounded-lg border p-5", BORDER_STYLES.open)}>
      <div className="text-xs font-medium tracking-wide text-paper-500 uppercase dark:text-paper-400">
        Generic entry has occurred
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="font-mono text-3xl font-semibold tabular-nums text-paper-900 dark:text-paper-50">
          {formatDate(realEntry.date)}
        </span>
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-statute-700 dark:text-statute-400">
          <span className="h-2 w-2 rounded-full bg-statute-500" />
          {formatRelativeDays(days)}
        </span>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-paper-600 dark:text-paper-400">
        {sourceSentence(realEntry.matches)}{" "}
        <a href="#generic-challenges" className="font-medium text-ledger-700 hover:underline dark:text-ledger-400">
          See challenge details below ↓
        </a>
      </p>
      {estimate.date && (
        <div className="mt-3 border-t border-statute-200/60 pt-3 dark:border-statute-900/60">
          <p className="max-w-2xl text-xs text-paper-500 dark:text-paper-500">
            Originally estimated: <span className="font-mono">{formatDate(estimate.date)}</span>, based on{" "}
            {estimate.controllingLabel}
            {estimate.dateConfidence === "confirmed"
              ? " (its term is USPTO-verified)"
              : " (not yet checked against USPTO records)"}{" "}
            — actual generic entry occurred earlier.
          </p>
        </div>
      )}
    </div>
  );
}

function EstimateHero({ estimate }: { estimate: GenericEntryEstimate }) {
  const urgency = estimate.date ? urgencyOf(daysFromToday(estimate.date)) : "none";

  return (
    <div className={clsx("rounded-lg border p-5", BORDER_STYLES[urgency])}>
      <div className="text-xs font-medium tracking-wide text-paper-500 uppercase dark:text-paper-400">
        Estimated generic entry
      </div>
      <div className="mt-2">
        {estimate.date ? (
          <EntryDateCell date={estimate.date} size="lg" confidence={estimate.dateConfidence} />
        ) : (
          <span className="text-2xl font-semibold text-statute-700 dark:text-statute-400">
            No known barrier — open now
          </span>
        )}
      </div>
      {estimate.date && (
        <p className="mt-3 max-w-2xl text-sm text-paper-500 dark:text-paper-500">
          This date compares every currently-listed patent&apos;s term — adjusted for USPTO-granted Patent Term
          Adjustment where verified — against any applicable FDA regulatory exclusivity, and takes whichever
          protection expires latest.
        </p>
      )}
      <p className="mt-1.5 max-w-2xl text-sm text-paper-600 dark:text-paper-400">{estimate.basis}</p>
    </div>
  );
}

export function GenericEntryCallout({
  estimate,
  challenges,
}: {
  estimate: GenericEntryEstimate;
  challenges: DrugDetail["genericChallenges"];
}) {
  const realEntry = findRealEntry(challenges);
  if (realEntry) return <RealEntryHero realEntry={realEntry} estimate={estimate} />;
  return <EstimateHero estimate={estimate} />;
}
