import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getPortfolioStats, getRecentActivity } from "@/lib/home/activity";
import { getExpiryTimelineBuckets } from "@/lib/drugs/queries";
import { StatTile } from "@/components/home/StatTile";
import { ExpiryTimeline } from "@/components/home/ExpiryTimeline";
import { ActivityFeed } from "@/components/home/ActivityFeed";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireUser();

  const [stats, timeline, activity] = await Promise.all([
    getPortfolioStats(),
    getExpiryTimelineBuckets(),
    getRecentActivity(5),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-paper-900 dark:text-paper-50">Home</h1>
        <p className="mt-1 text-sm text-paper-500 dark:text-paper-400">
          What&apos;s changed across the tracked portfolio, and what&apos;s coming up.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Tracked products" value={stats.totalTracked.toLocaleString()} />
        <StatTile
          label="Expiring in 90 days"
          value={stats.within90Days.toLocaleString()}
          caption={`${stats.within30Days} within 30d · ${stats.within365Days} within 1y`}
          accent="rust"
        />
        <StatTile label="Active generic challenges" value={stats.activeChallenges.toLocaleString()} accent="flag" />
        <StatTile
          label="Entry ahead of estimate"
          value={stats.divergenceCount.toLocaleString()}
          caption="Confirmed marketing before computed expiry"
          accent="statute"
        />
      </section>

      <section>
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-paper-900 dark:text-paper-50">Upcoming expirations</h2>
          <Link href="/drugs" className="text-xs font-medium text-ledger-700 hover:underline dark:text-ledger-400">
            Open full search →
          </Link>
        </div>
        <ExpiryTimeline buckets={timeline} />
      </section>

      <section>
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-paper-900 dark:text-paper-50">Recent activity</h2>
          <Link href="/activity" className="text-xs font-medium text-ledger-700 hover:underline dark:text-ledger-400">
            View all activity →
          </Link>
        </div>
        <ActivityFeed items={activity} />
      </section>
    </div>
  );
}
