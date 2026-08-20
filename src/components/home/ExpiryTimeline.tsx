import Link from "next/link";
import type { ExpiryTimelineBucket } from "@/lib/drugs/queries";

function monthLabel(monthStart: string): { month: string; year: string } {
  const d = new Date(`${monthStart}T00:00:00Z`);
  return {
    month: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
    year: d.toLocaleDateString("en-US", { year: "numeric", timeZone: "UTC" }),
  };
}

function monthEnd(monthStart: string): string {
  const d = new Date(`${monthStart}T00:00:00Z`);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
}

// The one deliberate visual risk in this redesign — a real calendar
// timeline rather than a generic bar chart, because "when does
// protection expire" is spatially, literally a timeline question. Bar
// heights are relative to the busiest month in the current 12-month
// window, with a visible floor so a zero-count month still registers as
// a real (empty) month rather than disappearing.
export function ExpiryTimeline({ buckets }: { buckets: ExpiryTimelineBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[640px] items-end gap-2 px-1 pt-6 pb-2 sm:min-w-0">
        {buckets.map((b) => {
          const { month, year } = monthLabel(b.monthStart);
          const heightPct = b.count === 0 ? 4 : Math.max(8, Math.round((b.count / max) * 100));
          return (
            <Link
              key={b.monthStart}
              href={`/drugs?expiresAfter=${b.monthStart}&expiresBefore=${monthEnd(b.monthStart)}`}
              className="group flex flex-1 flex-col items-center gap-2"
            >
              <span className="font-mono text-[11px] tabular-nums text-paper-500 opacity-0 group-hover:opacity-100 dark:text-paper-400">
                {b.count}
              </span>
              <div className="flex h-24 w-full items-end">
                <div
                  className="w-full rounded-t bg-ledger-500/70 transition-colors group-hover:bg-ledger-600 dark:bg-ledger-400/60 dark:group-hover:bg-ledger-400"
                  style={{ height: `${heightPct}%` }}
                />
              </div>
              <span className="text-[11px] text-paper-600 group-hover:text-ledger-700 dark:text-paper-400 dark:group-hover:text-ledger-400">
                {month}
                <span className="ml-0.5 text-paper-400 dark:text-paper-600">{year.slice(2)}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
