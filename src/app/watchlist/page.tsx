import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getWatchlist } from "@/lib/watchlist/queries";
import { titleCase, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const user = await requireUser();
  const items = await getWatchlist(user.id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-paper-900 dark:text-paper-50">Watchlist</h1>
        <p className="mt-1 text-sm text-paper-500 dark:text-paper-400">
          Products you&apos;ve starred from their detail page — quick access, nothing else changes about how they&apos;re
          tracked.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-paper-200 px-4 py-8 text-center text-sm text-paper-500 dark:border-paper-800 dark:text-paper-400">
          Nothing on your watchlist yet. Open any drug or biologic and select &quot;Watch&quot; to add it here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-paper-200 dark:divide-paper-800">
          {items.map((item) => (
            <li key={item.watchlistItemId}>
              <Link
                href={item.href}
                className="flex items-center justify-between gap-3 px-1 py-3 hover:bg-paper-100 dark:hover:bg-paper-900"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-paper-900 dark:text-paper-50">
                      {titleCase(item.name)}
                    </span>
                    <span className="shrink-0 rounded bg-paper-100 px-1.5 py-0.5 text-[10px] font-medium text-paper-600 dark:bg-paper-800 dark:text-paper-400">
                      {item.productType === "drug" ? "Orange Book" : "Purple Book"}
                    </span>
                  </div>
                  <p className="truncate text-xs text-paper-500 dark:text-paper-400">{titleCase(item.alternateName)}</p>
                </div>
                <span className="shrink-0 font-mono text-xs tabular-nums text-paper-400 dark:text-paper-600">
                  added {formatDate(item.addedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
