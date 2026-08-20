import Link from "next/link";
import type { ActivityItem, ActivityType } from "@/lib/home/activity";
import { formatDate } from "@/lib/format";

const TYPE_LABELS: Record<ActivityType, string> = {
  new_challenge: "Challenge filed",
  decision_posted: "180-day decision",
  marketing_recorded: "Generic on market",
  patent_confirmed: "Term confirmed",
};

const TYPE_STYLES: Record<ActivityType, string> = {
  new_challenge: "bg-ledger-50 text-ledger-700 dark:bg-ledger-500/10 dark:text-ledger-400",
  decision_posted: "bg-flag-50 text-flag-700 dark:bg-flag-500/10 dark:text-flag-400",
  marketing_recorded: "bg-rust-50 text-rust-700 dark:bg-rust-500/10 dark:text-rust-400",
  patent_confirmed: "bg-statute-50 text-statute-700 dark:bg-statute-500/10 dark:text-statute-400",
};

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <p className="px-1 py-6 text-sm text-paper-500 dark:text-paper-400">
        No new challenge filings, exclusivity decisions, marketing dates, or confirmed patent terms in the last 30
        days.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-paper-200 dark:divide-paper-800">
      {items.map((item, i) => (
        <li key={`${item.href}-${item.type}-${i}`}>
          <Link
            href={item.href}
            className="flex items-start gap-3 px-1 py-2.5 hover:bg-paper-100 dark:hover:bg-paper-900"
          >
            <span
              className={`mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${TYPE_STYLES[item.type]}`}
            >
              {TYPE_LABELS[item.type]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-paper-900 dark:text-paper-50">
                  {item.productName}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-paper-500 dark:text-paper-400">
                  {formatDate(item.date)}
                </span>
              </div>
              <p className="text-xs text-paper-600 dark:text-paper-400">{item.detail}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
