import type { DrugDetail } from "@/lib/drugs/schemas";
import { formatDate } from "@/lib/format";

export function ExclusivitiesTable({ exclusivities }: { exclusivities: DrugDetail["exclusivities"] }) {
  if (exclusivities.length === 0) {
    return (
      <p className="px-1 py-6 text-sm text-paper-500 dark:text-paper-400">No exclusivities on file for this drug.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-paper-200 text-left text-xs text-paper-500 dark:border-paper-800 dark:text-paper-400">
            <th className="py-2 pr-4 font-medium">Code</th>
            <th className="py-2 pr-4 font-medium">Description</th>
            <th className="py-2 pr-4 font-medium">Granted</th>
            <th className="py-2 pr-4 font-medium">Expires</th>
          </tr>
        </thead>
        <tbody>
          {exclusivities.map((e) => (
            <tr key={e.id} className="border-b border-paper-100 last:border-0 dark:border-paper-900">
              <td className="py-2.5 pr-4">
                <span className="rounded bg-paper-100 px-1.5 py-0.5 font-mono text-xs font-medium text-paper-700 dark:bg-paper-800 dark:text-paper-300">
                  {e.code}
                </span>
              </td>
              <td className="py-2.5 pr-4 text-paper-600 dark:text-paper-400">
                {e.description ?? <span className="text-paper-300 dark:text-paper-700">—</span>}
              </td>
              <td className="py-2.5 pr-4 font-mono tabular-nums text-paper-500 dark:text-paper-400">
                {e.grantedDate ? formatDate(e.grantedDate) : <span className="text-paper-300 dark:text-paper-700">—</span>}
              </td>
              <td className="py-2.5 pr-4 font-medium font-mono tabular-nums text-paper-900 dark:text-paper-50">
                {formatDate(e.expirationDate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
