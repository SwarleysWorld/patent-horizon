import clsx from "clsx";
import { daysFromToday, formatDate, formatRelativeDays, urgencyOf, type Urgency } from "@/lib/format";

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

export function EntryDateCell({ date, size = "sm" }: { date: string; size?: "sm" | "lg" }) {
  const days = daysFromToday(date);
  const urgency = urgencyOf(days);
  const relative = urgency === "open" ? RELATIVE_LABEL.open : formatRelativeDays(days);

  if (size === "lg") {
    return (
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {formatDate(date)}
        </span>
        <span className={clsx("inline-flex items-center gap-1.5 text-sm font-medium", TEXT_STYLES[urgency])}>
          <span className={clsx("h-2 w-2 rounded-full", DOT_STYLES[urgency])} />
          {relative}
        </span>
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
    </div>
  );
}
