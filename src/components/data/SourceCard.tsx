import clsx from "clsx";
import type { DataSourceStatus } from "@/lib/ingestion/status";

const STATUS_STYLES: Record<string, string> = {
  SUCCESS: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20",
  PARTIAL: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20",
  FAILED: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20",
  RUNNING: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20",
};

function formatDateTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", STATUS_STYLES[status] ?? STATUS_STYLES.FAILED)}>
      {status}
    </span>
  );
}

export function SourceCard({ source, command }: { source: DataSourceStatus; command: string }) {
  const run = source.lastRun;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{source.name}</h3>
        {run && <StatusBadge status={run.status} />}
      </div>
      {!run ? (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Never run yet.</p>
      ) : (
        <>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Last run {formatDateTime(run.startedAt)}
            {run.finishedAt && <> &middot; finished {formatDateTime(run.finishedAt)}</>}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-zinc-400">Products</dt>
              <dd className="tabular-nums text-zinc-800 dark:text-zinc-200">{run.drugsUpserted.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">Patents</dt>
              <dd className="tabular-nums text-zinc-800 dark:text-zinc-200">{run.patentsUpserted.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">Exclusivities</dt>
              <dd className="tabular-nums text-zinc-800 dark:text-zinc-200">{run.exclusivitiesUpserted.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">Rows skipped</dt>
              <dd className="tabular-nums text-zinc-800 dark:text-zinc-200">{run.rowsSkipped.toLocaleString()}</dd>
            </div>
          </dl>
        </>
      )}
      <p className="mt-3 border-t border-zinc-100 pt-2 font-mono text-[11px] text-zinc-400 dark:border-zinc-900">{command}</p>
    </div>
  );
}
