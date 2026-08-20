import clsx from "clsx";
import type { GenericEntryEstimate } from "@/lib/drugs/schemas";
import { urgencyOf, daysFromToday } from "@/lib/format";
import { EntryDateCell } from "./EntryDateCell";

const BORDER_STYLES = {
  open: "border-statute-200 bg-statute-50/60 dark:border-statute-900 dark:bg-statute-500/5",
  imminent: "border-rust-200 bg-rust-50/60 dark:border-rust-900 dark:bg-rust-500/5",
  upcoming: "border-flag-200 bg-flag-50/60 dark:border-flag-900 dark:bg-flag-500/5",
  distant: "border-paper-200 bg-paper-50 dark:border-paper-800 dark:bg-paper-900/40",
  none: "border-paper-200 bg-paper-50 dark:border-paper-800 dark:bg-paper-900/40",
};

export function GenericEntryCallout({ estimate }: { estimate: GenericEntryEstimate }) {
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
