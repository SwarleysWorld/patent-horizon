"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { toggleWatchlistAction } from "@/app/watchlist/actions";
import type { WatchlistTarget } from "@/lib/watchlist/queries";

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.5z"
      />
    </svg>
  );
}

export function WatchlistToggle({ target, initialWatching }: { target: WatchlistTarget; initialWatching: boolean }) {
  const [watching, setWatching] = useState(initialWatching);
  const [isPending, startTransition] = useTransition();
  const pathname = usePathname();

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          const result = await toggleWatchlistAction(target, pathname);
          setWatching(result.watching);
        })
      }
      disabled={isPending}
      aria-pressed={watching}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
        watching
          ? "border-flag-600/30 bg-flag-50 text-flag-700 hover:bg-flag-100 dark:border-flag-500/30 dark:bg-flag-500/10 dark:text-flag-400 dark:hover:bg-flag-500/20"
          : "border-paper-300 text-paper-600 hover:bg-paper-100 dark:border-paper-700 dark:text-paper-400 dark:hover:bg-paper-900",
      )}
      title={watching ? "Remove from watchlist" : "Add to watchlist"}
    >
      <StarIcon filled={watching} />
      {watching ? "Watching" : "Watch"}
    </button>
  );
}
