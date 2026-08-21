import clsx from "clsx";
import type { DrugDetail } from "@/lib/drugs/schemas";
import { formatDate } from "@/lib/format";

function AdjustmentBadge({ days }: { days: number | null }) {
  if (days === null) {
    return (
      <span
        className="inline-flex items-center rounded bg-flag-50 px-1.5 py-0.5 text-[11px] font-medium text-flag-700 dark:bg-flag-500/10 dark:text-flag-400"
        title="Not yet checked against USPTO Patent Term Adjustment records — the effective expiry shown is the source's own listed figure and could move once verified"
      >
        Pending
      </span>
    );
  }
  if (days === 0) {
    return (
      <span className="text-paper-500 dark:text-paper-400" title="USPTO-verified — no adjustment applied">
        0d
      </span>
    );
  }
  const positive = days > 0;
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium font-mono tabular-nums",
        positive
          ? "bg-statute-50 text-statute-700 dark:bg-statute-500/10 dark:text-statute-400"
          : "bg-rust-50 text-rust-700 dark:bg-rust-500/10 dark:text-rust-400",
      )}
      title={`Effective expiry is ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ${positive ? "later" : "earlier"} than the nominal date`}
    >
      {positive ? "+" : ""}
      {days}d
    </span>
  );
}

function CoverageTags({ substance, product }: { substance: boolean; product: boolean }) {
  if (!substance && !product) return <span className="text-paper-300 dark:text-paper-700">—</span>;
  return (
    <div className="flex gap-1">
      {substance && (
        <span
          className="rounded bg-paper-100 px-1 py-0.5 text-[10px] font-medium text-paper-600 dark:bg-paper-800 dark:text-paper-400"
          title="Covers drug substance"
        >
          DS
        </span>
      )}
      {product && (
        <span
          className="rounded bg-paper-100 px-1 py-0.5 text-[10px] font-medium text-paper-600 dark:bg-paper-800 dark:text-paper-400"
          title="Covers drug product"
        >
          DP
        </span>
      )}
    </div>
  );
}

export function PatentsTable({ patents }: { patents: DrugDetail["patents"] }) {
  if (patents.length === 0) {
    return <p className="px-1 py-6 text-sm text-paper-500 dark:text-paper-400">No patents on file for this drug.</p>;
  }

  const hasPending = patents.some((p) => p.expiryAdjustmentDays === null);

  return (
    <div className="overflow-x-auto">
      <p className="mb-2 px-1 text-xs text-paper-500 dark:text-paper-400">
        <span className="font-medium text-paper-600 dark:text-paper-300">DS</span> = covers the drug substance
        (active ingredient) &nbsp;·&nbsp; <span className="font-medium text-paper-600 dark:text-paper-300">DP</span> =
        covers the drug product (the formulated product).
        {hasPending && (
          <>
            {" "}
            <span className="font-medium text-flag-700 dark:text-flag-400">Pending</span> means this patent&apos;s
            expiry hasn&apos;t been checked against USPTO records yet — the &quot;Effective expiry&quot; shown is
            still the source&apos;s own listed date and could move once verified.
          </>
        )}
      </p>
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-paper-200 text-left text-xs text-paper-500 dark:border-paper-800 dark:text-paper-400">
            <th className="py-2 pr-4 font-medium">Patent</th>
            <th className="py-2 pr-4 font-medium">Covers</th>
            <th className="py-2 pr-4 font-medium" title="An FDA-assigned code identifying the specific approved method of use this patent claims — not decoded further here">
              Use code
            </th>
            <th className="py-2 pr-4 font-medium">Nominal expiry</th>
            <th className="py-2 pr-4 font-medium">Effective expiry</th>
            <th className="py-2 pr-4 text-right font-medium" title="How many days USPTO's Patent Term Adjustment shifted this patent's expiry, once checked">
              PTA Adjustment
            </th>
          </tr>
        </thead>
        <tbody>
          {patents.map((p) => (
            <tr
              key={p.id}
              className={clsx(
                "border-b border-paper-100 last:border-0 dark:border-paper-900",
                p.delistedAt && "opacity-50",
              )}
            >
              <td className="py-2.5 pr-4 font-mono text-xs text-paper-800 dark:text-paper-200">
                {p.patentNumber}
                {p.delistedAt && (
                  <span className="ml-2 rounded bg-paper-100 px-1 py-0.5 text-[10px] font-sans text-paper-500 dark:bg-paper-800 dark:text-paper-400">
                    Delisted
                  </span>
                )}
                {p.manuallyEntered && (
                  <span
                    className="ml-2 rounded bg-ledger-50 px-1 py-0.5 text-[10px] font-sans font-medium text-ledger-700 dark:bg-ledger-500/10 dark:text-ledger-400"
                    title="Entered manually by an Analyst, not from an automated pipeline — see /data's audit log"
                  >
                    Manual
                  </span>
                )}
              </td>
              <td className="py-2.5 pr-4">
                <CoverageTags substance={p.coversDrugSubstance} product={p.coversDrugProduct} />
              </td>
              <td className="py-2.5 pr-4 font-mono text-xs text-paper-500 dark:text-paper-400">
                {p.useCode || <span className="text-paper-300 dark:text-paper-700">—</span>}
              </td>
              <td className="py-2.5 pr-4 font-mono tabular-nums text-paper-500 dark:text-paper-400">
                {formatDate(p.nominalExpiryDate)}
              </td>
              <td className="py-2.5 pr-4 font-medium font-mono tabular-nums text-paper-900 dark:text-paper-50">
                {formatDate(p.effectiveExpiryDate)}
              </td>
              <td className="py-2.5 pr-4 text-right">
                <AdjustmentBadge days={p.expiryAdjustmentDays} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
