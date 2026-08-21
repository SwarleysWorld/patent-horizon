import { getIngestionStatus } from "@/lib/ingestion/status";
import { requireAnalyst } from "@/lib/session";
import { SourceCard } from "@/components/data/SourceCard";
import { ProgressBar } from "@/components/data/ProgressBar";
import { AutoRefresh } from "@/components/data/AutoRefresh";
import { TriggerButton } from "@/components/data/TriggerButton";
import { StopButton } from "@/components/data/StopButton";
import { ManualEntryPanel } from "@/components/data/ManualEntryPanel";
import { UnlinkedEntriesList } from "@/components/data/UnlinkedEntriesList";
import { ManualEntryAuditLog } from "@/components/data/ManualEntryAuditLog";
import { getUnlinkedManualEntries, getManualEntryAuditLog } from "@/lib/ingestion/manualEntry";

export const dynamic = "force-dynamic";

function errorMessageOf(summary: unknown): string {
  if (summary && typeof summary === "object" && typeof (summary as Record<string, unknown>).errorMessage === "string") {
    return (summary as Record<string, unknown>).errorMessage as string;
  }
  return "Last run failed.";
}

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
  // "Refresh all" only reserves/runs the three fast FDA pipelines (see
  // orchestrator.ts's PIPELINE_ORDER) — PTA and litigation each have their
  // own independent trigger and rate limit, so they're deliberately not
  // part of this check.
  const fastSources = status.sources.slice(0, 3);
  const anyFastRunning = fastSources.some((s) => s.lastRun?.status === "RUNNING");
  // Multiple pipelines can legitimately run at once — e.g. PTA (hours-long)
  // and litigation (its own independent trigger) alongside a "Refresh all"
  // batch — so this lists every one currently RUNNING, not just the first
  // found. Showing only one made the banner contradict a source card right
  // below it that clearly said RUNNING.
  const runningSources = status.sources.filter((s) => s.lastRun?.status === "RUNNING");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
      <AutoRefresh fast={runningSources.length > 0} />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-paper-900 dark:text-paper-50">Data</h1>
          <p className="text-sm text-paper-500 dark:text-paper-400">
            Where the product&rsquo;s data comes from, when it was last refreshed, and how far along
            patent-term enrichment is. This page re-checks itself automatically (every 4 seconds while
            something&rsquo;s running, otherwise every 20) &mdash; leave it open to watch a run progress.
          </p>
        </div>
        <TriggerButton pipeline="all" label="Refresh all" disabled={anyFastRunning} />
      </div>

      {runningSources.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-ledger-200 bg-ledger-50 px-3 py-2 text-xs text-ledger-700 dark:border-ledger-800 dark:bg-ledger-500/10 dark:text-ledger-400">
          {runningSources.map((s) => (
            <div key={s.name} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-ledger-500" />
              Running now: <span className="font-medium">{s.name}</span>
              {s.lastRun && <> &mdash; started {timeAgo(s.lastRun.startedAt)}.</>}
            </div>
          ))}
        </div>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-paper-900 dark:text-paper-50">Sources</h2>
        <div className="grid gap-3 sm:grid-cols-1">
          <SourceCard
            source={status.sources[0]}
            command="npm run ingest:orange-book"
            pipeline="orange_book"
            blockedByOtherRun={anyFastRunning}
          />
          <SourceCard
            source={status.sources[1]}
            command="npm run ingest:purple-book"
            pipeline="purple_book"
            blockedByOtherRun={anyFastRunning}
          />
          <SourceCard
            source={status.sources[2]}
            command="npm run ingest:paragraph-iv"
            pipeline="paragraph_iv"
            blockedByOtherRun={anyFastRunning}
            statLabels={["Challenges", "Matched to a drug", "Drug links created", "Rows skipped"]}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-paper-900 dark:text-paper-50">Federal litigation tracking</h2>
        <div className="grid gap-3 sm:grid-cols-1">
          <SourceCard
            source={status.sources[4]}
            command="npm run ingest:litigation"
            pipeline="litigation"
            statLabels={["Cases touched", "Dockets upserted", "Exclusivities", "Issues"]}
          />
        </div>
        <p className="mt-2 text-xs text-paper-500 dark:text-paper-400">
          Checks CourtListener for Hatch-Waxman litigation involving companies with an existing Paragraph
          IV filing, a batch of 25 at a time. Bound by CourtListener&rsquo;s free-tier rate limit (5
          requests/minute, 125/day) &mdash; deliberately kept out of &ldquo;Refresh all&rdquo; so one click
          can&rsquo;t silently burn the day&rsquo;s quota. A full pass over every candidate takes several runs;
          re-running just picks up the companies checked longest ago.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-paper-900 dark:text-paper-50">Litigation complaint-text matching</h2>
        <div className="grid gap-3 sm:grid-cols-1">
          <SourceCard
            source={status.sources[6]}
            command="npm run enrich:litigation-complaints"
            pipeline="litigation_complaints"
            statLabels={["Upgraded (any method)", "Matched via patent", "Matched via brand name", "Not upgraded"]}
          />
        </div>
        <p className="mt-2 text-xs text-paper-500 dark:text-paper-400">
          Company-name matching alone can&rsquo;t tell which of a company&rsquo;s products a case concerns —
          this fetches each case&rsquo;s actual complaint (Document 1) from CourtListener&rsquo;s free RECAP
          archive and extracts the asserted patent number(s) or brand name to confirm the specific product,
          upgrading the case to high confidence when it can. Free documents only &mdash; cases whose complaint
          isn&rsquo;t already in RECAP stay at their current confidence rather than triggering a paid PACER
          purchase. Shares the litigation pipeline&rsquo;s CourtListener rate limit.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-paper-900 dark:text-paper-50">Settlement disclosures (SEC EDGAR)</h2>
        <div className="grid gap-3 sm:grid-cols-1">
          <SourceCard
            source={status.sources[5]}
            command="npm run ingest:settlements"
            pipeline="settlements"
            statLabels={["Settlements extracted", "Filings scanned", "Drug links created", "Issues"]}
          />
        </div>
        <p className="mt-2 text-xs text-paper-500 dark:text-paper-400">
          Searches SEC EDGAR&rsquo;s full-text search by brand name for 10-K/10-Q disclosures of a
          settlement (a licensed generic-entry date agreed outside of any court ruling &mdash; the kind of
          fact RECAP docket data alone can&rsquo;t surface), a batch of 15 brands at a time. Lower confidence
          than every other source here: extracted from filing prose via pattern-matching, not an exact-ID
          match &mdash; always shown alongside the computed estimate on a product page, never in place of it.
        </p>
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
            {status.sources[3].lastRun?.status === "RUNNING" ? (
              <StopButton pipeline="pta" />
            ) : (
              <TriggerButton pipeline="pta" label="Run now" disabled={false} />
            )}
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
          {status.sources[3].lastRun?.status === "FAILED" && (
            <p className="mb-3 rounded bg-rust-50 px-2 py-1.5 text-xs text-rust-700 dark:bg-rust-500/10 dark:text-rust-400">
              {errorMessageOf(status.sources[3].lastRun?.summary)}
            </p>
          )}
          {status.sources[3].lastRun?.status === "CANCELLED" && (
            <p className="mb-3 rounded bg-paper-100 px-2 py-1.5 text-xs text-paper-600 dark:bg-paper-800/50 dark:text-paper-400">
              Stopped by request before finishing. Whatever it had already written stays &mdash; run it again to
              pick up where it left off.
            </p>
          )}
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
