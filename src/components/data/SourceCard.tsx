import clsx from "clsx";
import type { DataSourceStatus } from "@/lib/ingestion/status";
import { TriggerButton, type TriggerPipelineKey } from "./TriggerButton";
import { StopButton, type StoppablePipelineKey } from "./StopButton";

const STATUS_STYLES: Record<string, string> = {
  SUCCESS: "bg-statute-50 text-statute-700 ring-statute-600/20 dark:bg-statute-500/10 dark:text-statute-400 dark:ring-statute-500/20",
  PARTIAL: "bg-flag-50 text-flag-700 ring-flag-600/20 dark:bg-flag-500/10 dark:text-flag-400 dark:ring-flag-500/20",
  FAILED: "bg-rust-50 text-rust-700 ring-rust-600/20 dark:bg-rust-500/10 dark:text-rust-400 dark:ring-rust-500/20",
  RUNNING: "bg-ledger-50 text-ledger-700 ring-ledger-600/20 dark:bg-ledger-500/10 dark:text-ledger-400 dark:ring-ledger-500/20",
  CANCELLED: "bg-paper-100 text-paper-600 ring-paper-300 dark:bg-paper-800/50 dark:text-paper-400 dark:ring-paper-700",
};

// Every real pipeline supports stopping mid-run now (see cancellation.ts
// and each pipeline's own run loop) — "all" is the only TriggerPipelineKey
// that isn't a real pipeline, and SourceCard is never given that one.

function formatDateTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

interface IssueCategory {
  reason: string;
  count: number;
}

// Every pipeline's IngestionRunSummary sets `errorMessage` on FAILED and
// `totalIssues`/`issueCategories` on PARTIAL, but each pipeline's summary
// type otherwise differs (PTA's has no issueCategories at all — see
// src/lib/ingestion/pta/index.ts) — so this reads defensively out of the
// loosely-typed Json blob rather than assuming one shared shape.
function summaryDetail(summary: unknown): { errorMessage: string | null; totalIssues: number | null; topIssue: IssueCategory | null } {
  if (!summary || typeof summary !== "object") return { errorMessage: null, totalIssues: null, topIssue: null };
  const s = summary as Record<string, unknown>;
  let errorMessage = typeof s.errorMessage === "string" ? s.errorMessage : null;
  // Litigation's mid-run auth-abort path (see litigation/index.ts) sets
  // abortedOnAuthError in the stored summary but no errorMessage string —
  // the message only lived on the in-memory return value, never written
  // to the DB row this page reads.
  if (!errorMessage && s.abortedOnAuthError === true) {
    errorMessage = "Aborted after an auth error — check COURTLISTENER_API_KEY.";
  }
  const totalIssues = typeof s.totalIssues === "number" ? s.totalIssues : null;
  const categories = Array.isArray(s.issueCategories) ? (s.issueCategories as IssueCategory[]) : null;
  const topIssue = categories && categories.length > 0 ? categories[0] : null;
  return { errorMessage, totalIssues, topIssue };
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", STATUS_STYLES[status] ?? STATUS_STYLES.FAILED)}>
      {status}
    </span>
  );
}

export function SourceCard({
  source,
  command,
  pipeline,
  blockedByOtherRun,
  statLabels = ["Products", "Patents", "Exclusivities", "Rows skipped"],
}: {
  source: DataSourceStatus;
  command: string;
  pipeline?: TriggerPipelineKey;
  // True while a *different* pipeline this one shares a concurrency
  // reservation with (see orchestrator.ts's PIPELINE_ORDER) is running —
  // e.g. all three "Refresh all" pipelines while any one of them is
  // mid-run. Without this, that button looked clickable and would 409.
  blockedByOtherRun?: boolean;
  // [drugsUpserted, patentsUpserted, exclusivitiesUpserted, rowsSkipped]'s
  // display labels. Defaults to the FDA-source wording; pipelines that
  // don't literally touch Patent/Exclusivity rows (paragraph_iv,
  // litigation) reuse those same generic DB columns for their own
  // downstream counts (see each pipeline's own index.ts) and pass labels
  // that match what's actually stored instead of showing "0" next to
  // "Patents" on a run that touched none.
  statLabels?: [string, string, string, string];
}) {
  const run = source.lastRun;
  const isRunning = run?.status === "RUNNING";
  const { errorMessage, totalIssues, topIssue } = summaryDetail(run?.summary);
  return (
    <div className="rounded-lg border border-paper-200 bg-paper-100 p-4 dark:border-paper-800 dark:bg-paper-950">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-paper-900 dark:text-paper-50">{source.name}</h3>
          {run && <StatusBadge status={run.status} />}
        </div>
        {pipeline && isRunning ? (
          <StopButton pipeline={pipeline as StoppablePipelineKey} />
        ) : (
          pipeline && (
            <TriggerButton pipeline={pipeline} disabled={isRunning || Boolean(blockedByOtherRun)} label="Run now" />
          )
        )}
      </div>
      {!run ? (
        <p className="mt-2 text-sm text-paper-500 dark:text-paper-400">Never run yet.</p>
      ) : (
        <>
          <p className="mt-2 text-xs text-paper-500 dark:text-paper-400">
            {isRunning ? (
              <span className="font-medium text-ledger-700 dark:text-ledger-400">Running since {formatDateTime(run.startedAt)}&hellip;</span>
            ) : (
              <>
                Last run {formatDateTime(run.startedAt)}
                {run.finishedAt && <> &middot; finished {formatDateTime(run.finishedAt)}</>}
              </>
            )}
          </p>
          {run.status === "CANCELLED" && (
            <p className="mt-2 rounded bg-paper-100 px-2 py-1.5 text-xs text-paper-600 dark:bg-paper-800/50 dark:text-paper-400">
              Stopped by request before finishing. Whatever it had already written stays &mdash; re-run to pick up
              where it left off.
            </p>
          )}
          {errorMessage && (
            <p className="mt-2 rounded bg-rust-50 px-2 py-1.5 text-xs text-rust-700 dark:bg-rust-500/10 dark:text-rust-400">
              {errorMessage}
            </p>
          )}
          {!errorMessage && totalIssues != null && totalIssues > 0 && (
            <p className="mt-2 rounded bg-flag-50 px-2 py-1.5 text-xs text-flag-700 dark:bg-flag-500/10 dark:text-flag-400">
              {totalIssues.toLocaleString()} data-quality note{totalIssues === 1 ? "" : "s"} on this run
              {topIssue && <> &mdash; most common: {topIssue.reason} ({topIssue.count.toLocaleString()}&times;)</>}
              {run.status === "PARTIAL" && ". The run itself completed and the data was written; these are per-row footnotes, not a stalled or broken run."}
            </p>
          )}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-paper-400">{statLabels[0]}</dt>
              <dd className="font-mono tabular-nums text-paper-800 dark:text-paper-200">{run.drugsUpserted.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-paper-400">{statLabels[1]}</dt>
              <dd className="font-mono tabular-nums text-paper-800 dark:text-paper-200">{run.patentsUpserted.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-paper-400">{statLabels[2]}</dt>
              <dd className="font-mono tabular-nums text-paper-800 dark:text-paper-200">{run.exclusivitiesUpserted.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-paper-400">{statLabels[3]}</dt>
              <dd className="font-mono tabular-nums text-paper-800 dark:text-paper-200">{run.rowsSkipped.toLocaleString()}</dd>
            </div>
          </dl>
        </>
      )}
      <p className="mt-3 border-t border-paper-100 pt-2 font-mono text-[11px] text-paper-400 dark:border-paper-900">{command}</p>
    </div>
  );
}
