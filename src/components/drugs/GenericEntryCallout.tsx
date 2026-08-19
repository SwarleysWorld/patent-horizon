import clsx from "clsx";
import type { GenericEntryEstimate } from "@/lib/drugs/schemas";
import { urgencyOf, daysFromToday } from "@/lib/format";
import { EntryDateCell } from "./EntryDateCell";

const BORDER_STYLES = {
  open: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-500/5",
  imminent: "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-500/5",
  upcoming: "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-500/5",
  distant: "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40",
  none: "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40",
};

export function GenericEntryCallout({ estimate }: { estimate: GenericEntryEstimate }) {
  const urgency = estimate.date ? urgencyOf(daysFromToday(estimate.date)) : "none";

  return (
    <div className={clsx("rounded-lg border p-5", BORDER_STYLES[urgency])}>
      <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        Estimated generic entry
      </div>
      <div className="mt-2">
        {estimate.date ? (
          <EntryDateCell date={estimate.date} size="lg" confidence={estimate.dateConfidence} />
        ) : (
          <span className="text-2xl font-semibold text-emerald-700 dark:text-emerald-400">
            No known barrier — open now
          </span>
        )}
      </div>
      <p className="mt-3 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">{estimate.basis}</p>
    </div>
  );
}
