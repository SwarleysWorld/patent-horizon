import clsx from "clsx";
import type { DrugDetail } from "@/lib/drugs/schemas";
import { formatDate } from "@/lib/format";

function AdjustmentBadge({ days }: { days: number | null }) {
  if (days === null) {
    return <span className="text-zinc-400 dark:text-zinc-600" title="Adjustment not yet confirmed">—</span>;
  }
  if (days === 0) {
    return <span className="text-zinc-500 dark:text-zinc-400">0d</span>;
  }
  const positive = days > 0;
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
        positive
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
          : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400",
      )}
      title={`Effective expiry is ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ${positive ? "later" : "earlier"} than the nominal date`}
    >
      {positive ? "+" : ""}
      {days}d
    </span>
  );
}

function CoverageTags({ substance, product }: { substance: boolean; product: boolean }) {
  if (!substance && !product) return <span className="text-zinc-300 dark:text-zinc-700">—</span>;
  return (
    <div className="flex gap-1">
      {substance && (
        <span
          className="rounded bg-zinc-100 px-1 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          title="Covers drug substance"
        >
          DS
        </span>
      )}
      {product && (
        <span
          className="rounded bg-zinc-100 px-1 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
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
    return <p className="px-1 py-6 text-sm text-zinc-500 dark:text-zinc-400">No patents on file for this drug.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="py-2 pr-4 font-medium">Patent</th>
            <th className="py-2 pr-4 font-medium">Covers</th>
            <th className="py-2 pr-4 font-medium">Use code</th>
            <th className="py-2 pr-4 font-medium">Nominal expiry</th>
            <th className="py-2 pr-4 font-medium">Effective expiry</th>
            <th className="py-2 pr-4 text-right font-medium">Adjustment</th>
          </tr>
        </thead>
        <tbody>
          {patents.map((p) => (
            <tr
              key={p.id}
              className={clsx(
                "border-b border-zinc-100 last:border-0 dark:border-zinc-900",
                p.delistedAt && "opacity-50",
              )}
            >
              <td className="py-2.5 pr-4 font-mono text-xs text-zinc-800 dark:text-zinc-200">
                {p.patentNumber}
                {p.delistedAt && (
                  <span className="ml-2 rounded bg-zinc-100 px-1 py-0.5 text-[10px] font-sans text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    Delisted
                  </span>
                )}
              </td>
              <td className="py-2.5 pr-4">
                <CoverageTags substance={p.coversDrugSubstance} product={p.coversDrugProduct} />
              </td>
              <td className="py-2.5 pr-4 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                {p.useCode || <span className="text-zinc-300 dark:text-zinc-700">—</span>}
              </td>
              <td className="py-2.5 pr-4 tabular-nums text-zinc-500 dark:text-zinc-400">
                {formatDate(p.nominalExpiryDate)}
              </td>
              <td className="py-2.5 pr-4 font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
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
