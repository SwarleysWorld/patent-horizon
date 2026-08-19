import clsx from "clsx";
import { daysFromToday, formatDate, formatRelativeDays, urgencyOf, type Urgency } from "@/lib/format";

type DateConfidence = "confirmed" | "pending_verification";

const DOT_STYLES: Record<Urgency, string> = {
  open: "bg-emerald-500",
  imminent: "bg-red-500",
  upcoming: "bg-amber-500",
  distant: "bg-zinc-400 dark:bg-zinc-600",
};

const TEXT_STYLES: Record<Urgency, string> = {
  open: "text-emerald-700 dark:text-emerald-400",
  imminent: "text-red-700 dark:text-red-400",
  upcoming: "text-amber-700 dark:text-amber-500",
  distant: "text-zinc-500 dark:text-zinc-400",
};

const RELATIVE_LABEL: Record<Urgency, string> = {
  open: "Open now",
  imminent: "",
  upcoming: "",
  distant: "",
};

// Same two states as GenericEntryEstimateSchema.dateConfidence — see there
// for the full rule. Shown wherever this date appears (list row or detail
// callout) so "is this number final or provisional" is never ambiguous,
// rather than only discoverable by cross-referencing a separate column.
const CONFIDENCE_TITLE: Record<DateConfidence, string> = {
  confirmed:
    "This date is set by an FDA exclusivity, or by a patent whose term has been independently checked against USPTO records.",
  pending_verification:
    "This date comes from the source's own listed patent expiry and has not yet been checked against USPTO Patent Term Adjustment records — it may move once verified.",
};

export function EntryDateCell({
  date,
  size = "sm",
  confidence,
}: {
  date: string;
  size?: "sm" | "lg";
  confidence?: DateConfidence | null;
}) {
  const days = daysFromToday(date);
  const urgency = urgencyOf(days);
  const relative = urgency === "open" ? RELATIVE_LABEL.open : formatRelativeDays(days);

  if (size === "lg") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {formatDate(date)}
          </span>
          <span className={clsx("inline-flex items-center gap-1.5 text-sm font-medium", TEXT_STYLES[urgency])}>
            <span className={clsx("h-2 w-2 rounded-full", DOT_STYLES[urgency])} />
            {relative}
          </span>
        </div>
        {confidence && (
          <span
            className={clsx(
              "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
              confidence === "confirmed"
                ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20"
                : "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20",
            )}
            title={CONFIDENCE_TITLE[confidence]}
          >
            {confidence === "confirmed" ? "USPTO-verified" : "Pending USPTO verification"}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="tabular-nums text-zinc-800 dark:text-zinc-200">{formatDate(date)}</span>
      <span className={clsx("inline-flex items-center gap-1 text-[11px] font-medium", TEXT_STYLES[urgency])}>
        <span className={clsx("h-1.5 w-1.5 rounded-full", DOT_STYLES[urgency])} />
        {relative}
      </span>
      {confidence === "pending_verification" && (
        <span
          className="rounded bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
          title={CONFIDENCE_TITLE.pending_verification}
        >
          Pending verification
        </span>
      )}
    </div>
  );
}
