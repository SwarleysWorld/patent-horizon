import clsx from "clsx";
import type { DataSourceStatus } from "@/lib/ingestion/status";
import { TriggerButton, type TriggerPipelineKey } from "./TriggerButton";

const STATUS_STYLES: Record<string, string> = {
  SUCCESS: "bg-statute-50 text-statute-700 ring-statute-600/20 dark:bg-statute-500/10 dark:text-statute-400 dark:ring-statute-500/20",
  PARTIAL: "bg-flag-50 text-flag-700 ring-flag-600/20 dark:bg-flag-500/10 dark:text-flag-400 dark:ring-flag-500/20",
  FAILED: "bg-rust-50 text-rust-700 ring-rust-600/20 dark:bg-rust-500/10 dark:text-rust-400 dark:ring-rust-500/20",
  RUNNING: "bg-ledger-50 text-ledger-700 ring-ledger-600/20 dark:bg-ledger-500/10 dark:text-ledger-400 dark:ring-ledger-500/20",
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

export function SourceCard({
  source,
  command,
  pipeline,
}: {
  source: DataSourceStatus;
  command: string;
  pipeline?: TriggerPipelineKey;
}) {
  const run = source.lastRun;
  return (
    <div className="rounded-lg border border-paper-200 bg-paper-100 p-4 dark:border-paper-800 dark:bg-paper-950">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-paper-900 dark:text-paper-50">{source.name}</h3>
          {run && <StatusBadge status={run.status} />}
        </div>
        {pipeline && <TriggerButton pipeline={pipeline} disabled={run?.status === "RUNNING"} label="Run now" />}
      </div>
      {!run ? (
        <p className="mt-2 text-sm text-paper-500 dark:text-paper-400">Never run yet.</p>
      ) : (
        <>
          <p className="mt-2 text-xs text-paper-500 dark:text-paper-400">
            Last run {formatDateTime(run.startedAt)}
            {run.finishedAt && <> &middot; finished {formatDateTime(run.finishedAt)}</>}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-paper-400">Products</dt>
              <dd className="font-mono tabular-nums text-paper-800 dark:text-paper-200">{run.drugsUpserted.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-paper-400">Patents</dt>
              <dd className="font-mono tabular-nums text-paper-800 dark:text-paper-200">{run.patentsUpserted.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-paper-400">Exclusivities</dt>
              <dd className="font-mono tabular-nums text-paper-800 dark:text-paper-200">{run.exclusivitiesUpserted.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-paper-400">Rows skipped</dt>
              <dd className="font-mono tabular-nums text-paper-800 dark:text-paper-200">{run.rowsSkipped.toLocaleString()}</dd>
            </div>
          </dl>
        </>
      )}
      <p className="mt-3 border-t border-paper-100 pt-2 font-mono text-[11px] text-paper-400 dark:border-paper-900">{command}</p>
    </div>
  );
}
