import { getIngestionStatus } from "@/lib/ingestion/status";
import { requireAnalyst } from "@/lib/session";
import { SourceCard } from "@/components/data/SourceCard";
import { ProgressBar } from "@/components/data/ProgressBar";
import { AutoRefresh } from "@/components/data/AutoRefresh";
import { TriggerButton } from "@/components/data/TriggerButton";
import { ManualEntryPanel } from "@/components/data/ManualEntryPanel";
import { UnlinkedEntriesList } from "@/components/data/UnlinkedEntriesList";
import { ManualEntryAuditLog } from "@/components/data/ManualEntryAuditLog";
import { getUnlinkedManualEntries, getManualEntryAuditLog } from "@/lib/ingestion/manualEntry";

export const dynamic = "force-dynamic";

function timeAgo(d: Date | null): string {
  if (!d) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export default async function DataPage() {
  await requireAnalyst();
  const [status, unlinkedEntries, auditRows] = await Promise.all([
    getIngestionStatus(),
    getUnlinkedManualEntries(),
    getManualEntryAuditLog(),
  ]);
  const { enrichment } = status;
  const anyRunning = status.sources.some((s) => s.lastRun?.status === "RUNNING");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
      <AutoRefresh />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-paper-900 dark:text-paper-50">Data</h1>
          <p className="text-sm text-paper-500 dark:text-paper-400">
            Where the product&rsquo;s data comes from, when it was last refreshed, and how far along
            patent-term enrichment is. This page re-checks itself automatically every 20 seconds while
            it&rsquo;s open &mdash; leave it open to watch a long-running refresh progress.
          </p>
        </div>
        <TriggerButton pipeline="all" label="Refresh all" disabled={anyRunning} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-paper-900 dark:text-paper-50">Sources</h2>
        <div className="grid gap-3 sm:grid-cols-1">
          <SourceCard source={status.sources[0]} command="npm run ingest:orange-book" pipeline="orange_book" />
          <SourceCard source={status.sources[1]} command="npm run ingest:purple-book" pipeline="purple_book" />
          <SourceCard source={status.sources[2]} command="npm run ingest:paragraph-iv" pipeline="paragraph_iv" />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-paper-900 dark:text-paper-50">Patent Term Adjustment enrichment</h2>
          <div className="flex items-center gap-2">
            <span
              className={
                enrichment.recentActivity
                  ? "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-statute-700 ring-1 ring-inset ring-statute-600/20 dark:text-statute-400 dark:ring-statute-500/20"
                  : "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-paper-500 ring-1 ring-inset ring-paper-300 dark:text-paper-400 dark:ring-paper-700"
              }
            >
              <span className={`h-1.5 w-1.5 rounded-full ${enrichment.recentActivity ? "bg-statute-500 animate-pulse" : "bg-paper-400"}`} />
              {enrichment.recentActivity ? "Running now" : "Idle"}
            </span>
            <TriggerButton pipeline="pta" label="Run now" disabled={status.sources[3].lastRun?.status === "RUNNING"} />
          </div>
        </div>
        <div className="rounded-lg border border-paper-200 bg-paper-100 p-4 dark:border-paper-800 dark:bg-paper-950">
          <p className="mb-3 text-xs text-paper-500 dark:text-paper-400">
            Runs one patent at a time against USPTO&rsquo;s rate limit &mdash; a full pass over
            every un-enriched patent takes hours, not minutes. Fully resumable: stop it anytime, and
            <code className="mx-1 rounded bg-paper-100 px-1 py-0.5 font-mono text-[11px] dark:bg-paper-900">
              npm run enrich:pta
            </code>
            picks up exactly where it left off. Last write: {timeAgo(enrichment.lastActivityAt)}.
          </p>
          <div className="flex flex-col gap-3">
            <ProgressBar label="Overall" done={enrichment.enrichedPatents} total={enrichment.totalPatents} />
            <ProgressBar label="Orange Book patents" done={enrichment.orangeBookEnriched} total={enrichment.orangeBookTotal} />
            <ProgressBar label="Purple Book patents" done={enrichment.purpleBookEnriched} total={enrichment.purpleBookTotal} />
          </div>
        </div>
      </section>

      <ManualEntryPanel />

      <UnlinkedEntriesList entries={unlinkedEntries} />

      <ManualEntryAuditLog rows={auditRows} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-paper-900 dark:text-paper-50">Run it yourself</h2>
        <div className="rounded-lg border border-paper-200 bg-paper-100 p-4 font-mono text-xs text-paper-700 dark:border-paper-800 dark:bg-paper-950 dark:text-paper-300">
          <p className="mb-1 font-sans text-xs text-paper-500 dark:text-paper-400">
            From the project directory, in order:
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap">
{`npm run refresh:data       # re-download + reclassify everything (a minute or two)
npm run enrich:pta         # correct patent dates against USPTO (hours; safe to stop/restart)`}
          </pre>
        </div>
      </section>
    </div>
  );
}
