import type { DrugDetail } from "@/lib/drugs/schemas";
import { formatDate } from "@/lib/format";

export function ExclusivitiesTable({ exclusivities }: { exclusivities: DrugDetail["exclusivities"] }) {
  if (exclusivities.length === 0) {
    return (
      <p className="px-1 py-6 text-sm text-zinc-500 dark:text-zinc-400">No exclusivities on file for this drug.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="py-2 pr-4 font-medium">Code</th>
            <th className="py-2 pr-4 font-medium">Description</th>
            <th className="py-2 pr-4 font-medium">Granted</th>
            <th className="py-2 pr-4 font-medium">Expires</th>
          </tr>
        </thead>
        <tbody>
          {exclusivities.map((e) => (
            <tr key={e.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
              <td className="py-2.5 pr-4">
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {e.code}
                </span>
              </td>
              <td className="py-2.5 pr-4 text-zinc-600 dark:text-zinc-400">
                {e.description ?? <span className="text-zinc-300 dark:text-zinc-700">—</span>}
              </td>
              <td className="py-2.5 pr-4 tabular-nums text-zinc-500 dark:text-zinc-400">
                {e.grantedDate ? formatDate(e.grantedDate) : <span className="text-zinc-300 dark:text-zinc-700">—</span>}
              </td>
              <td className="py-2.5 pr-4 font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                {formatDate(e.expirationDate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
