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
      <span className="text-xs text-paper-300 dark:text-paper-700" title="No patents on file for this result">
        —
      </span>
    );
  }
  if (days === null) {
    return (
      <span
        className="inline-flex items-center rounded-md bg-flag-50 px-2 py-1 text-xs font-medium text-flag-700 ring-1 ring-inset ring-flag-600/20 dark:bg-flag-500/10 dark:text-flag-400 dark:ring-flag-500/20"
        title="This result has patents on file, but none have been checked against USPTO Patent Term Adjustment records yet"
      >
        Pending
      </span>
    );
  }
  if (days === 0) {
    return (
      <span
        className="text-xs font-mono tabular-nums text-paper-400 dark:text-paper-600"
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
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold font-mono tabular-nums ring-1 ring-inset",
        positive
          ? "bg-statute-50 text-statute-700 ring-statute-600/20 dark:bg-statute-500/10 dark:text-statute-400 dark:ring-statute-500/20"
          : "bg-rust-50 text-rust-700 ring-rust-600/20 dark:bg-rust-500/10 dark:text-rust-400 dark:ring-rust-500/20",
      )}
      title={`USPTO-verified: effective expiry is ${Math.abs(days).toLocaleString()} day${Math.abs(days) === 1 ? "" : "s"} ${positive ? "later" : "earlier"} than the originally listed date`}
    >
      {positive ? "+" : ""}
      {days.toLocaleString()}d
    </span>
  );
}
