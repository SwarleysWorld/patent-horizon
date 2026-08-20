import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getActivityPage } from "@/lib/home/activity";
import { ActivityFeed } from "@/components/home/ActivityFeed";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;
  const offsetParam = typeof params.offset === "string" ? Number.parseInt(params.offset, 10) : 0;
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0;

  const { items, total } = await getActivityPage(PAGE_SIZE, offset);
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + items.length, total);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-paper-900 dark:text-paper-50">Recent activity</h1>
        <p className="mt-1 text-sm text-paper-500 dark:text-paper-400">
          Generic challenge filings, 180-day exclusivity decisions, first commercial marketing dates, and confirmed
          patent terms, sorted by when each actually happened.
        </p>
      </div>

      <ActivityFeed items={items} />

      <div className="flex items-center justify-between border-t border-paper-200 pt-3 text-xs text-paper-500 dark:border-paper-800 dark:text-paper-400">
        <span>{total === 0 ? "No results" : `Showing ${from}–${to} of ${total}`}</span>
        <div className="flex items-center gap-2">
          <Link
            href={`/activity?offset=${Math.max(0, offset - PAGE_SIZE)}`}
            aria-disabled={offset === 0}
            className={`rounded-md border border-paper-200 px-2 py-1 dark:border-paper-800 ${offset === 0 ? "pointer-events-none opacity-40" : "hover:bg-paper-100 dark:hover:bg-paper-900"}`}
          >
            Previous
          </Link>
          <Link
            href={`/activity?offset=${offset + PAGE_SIZE}`}
            aria-disabled={to >= total}
            className={`rounded-md border border-paper-200 px-2 py-1 dark:border-paper-800 ${to >= total ? "pointer-events-none opacity-40" : "hover:bg-paper-100 dark:hover:bg-paper-900"}`}
          >
            Next
          </Link>
        </div>
      </div>
    </div>
  );
}
