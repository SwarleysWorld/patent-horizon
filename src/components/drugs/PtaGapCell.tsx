import clsx from "clsx";

// The clearest demonstration of this product's core value — how many days
// USPTO's Patent Term Adjustment shifted a patent's real expiry versus the
// originally listed date — so this gets its own column with real visual
// weight, not a small muted number buried among others.
//
// `days === null` is ambiguous on its own — it means either "no patents at
// all" or "has patents, none checked against USPTO yet". Those are very
// different facts (nothing to verify vs. a number that could still move),
// so `patentCount` disambiguates which one this row is instead of both
// rendering as the same bare "—".
export function PtaGapCell({ days, patentCount }: { days: number | null; patentCount: number }) {
  if (patentCount === 0) {
    return (
      <span className="text-xs text-zinc-300 dark:text-zinc-700" title="No patents on file for this result">
        —
      </span>
    );
  }
  if (days === null) {
    return (
      <span
        className="inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20"
        title="This result has patents on file, but none have been checked against USPTO Patent Term Adjustment records yet"
      >
        Pending
      </span>
    );
  }
  if (days === 0) {
    return (
      <span
        className="text-xs tabular-nums text-zinc-400 dark:text-zinc-600"
        title="USPTO-verified — no adjustment applied"
      >
        0d
      </span>
    );
  }
  const positive = days > 0;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold tabular-nums ring-1 ring-inset",
        positive
          ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20"
          : "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20",
      )}
      title={`USPTO-verified: effective expiry is ${Math.abs(days).toLocaleString()} day${Math.abs(days) === 1 ? "" : "s"} ${positive ? "later" : "earlier"} than the originally listed date`}
    >
      {positive ? "+" : ""}
      {days.toLocaleString()}d
    </span>
  );
}
