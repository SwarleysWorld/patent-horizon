import { prisma } from "@/lib/prisma";
import type { ManualEntryAuditRow } from "@/lib/ingestion/manualEntry";

const ENTITY_LABELS: Record<ManualEntryAuditRow["entityType"], string> = {
  patent: "Patent",
  exclusivity: "Exclusivity",
  generic_challenge: "Generic challenge",
  litigation_case: "Litigation case",
};

function formatDateTime(d: Date): string {
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

// Server Component: resolves enteredByUserId -> analyst name/email via a
// separate batched lookup, since IngestionRecord.enteredByUserId is a
// plain string (no Prisma relation to User — same reasoning as
// WatchlistItem.userId), not a query-layer join.
export async function ManualEntryAuditLog({ rows }: { rows: ManualEntryAuditRow[] }) {
  if (rows.length === 0) return null;

  const userIds = [...new Set(rows.map((r) => r.enteredByUserId).filter((id): id is string => id != null))];
  const users = userIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-paper-900 dark:text-paper-50">Manual entry audit log</h2>
      <p className="mb-2 text-xs text-paper-500 dark:text-paper-400">
        Separate from the automated pipeline run history above — every manually entered or manually linked record,
        traceable to who did it and when.
      </p>
      <div className="overflow-x-auto rounded-lg border border-paper-200 dark:border-paper-800">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-paper-200 bg-paper-100 text-left text-xs text-paper-500 dark:border-paper-800 dark:bg-paper-950 dark:text-paper-400">
              <th className="px-3 py-2 font-medium">What</th>
              <th className="px-3 py-2 font-medium">Linked to</th>
              <th className="px-3 py-2 font-medium">By</th>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const user = r.enteredByUserId ? userById.get(r.enteredByUserId) : null;
              return (
                <tr key={r.id} className="border-b border-paper-100 last:border-0 dark:border-paper-900">
                  <td className="px-3 py-2">
                    <span className="mr-1.5 inline-flex items-center rounded bg-ledger-50 px-1.5 py-0.5 text-[10px] font-medium text-ledger-700 dark:bg-ledger-500/10 dark:text-ledger-400">
                      {ENTITY_LABELS[r.entityType]}
                    </span>
                    <span className="text-paper-800 dark:text-paper-200">{r.label}</span>
                  </td>
                  <td className="px-3 py-2 text-paper-600 dark:text-paper-400">{r.linkedProductName ?? <span className="text-paper-400 dark:text-paper-600">unlinked</span>}</td>
                  <td className="px-3 py-2 text-paper-600 dark:text-paper-400">{user?.name ?? user?.email ?? "—"}</td>
                  <td className="px-3 py-2 text-paper-500 dark:text-paper-400">{formatDateTime(r.verifiedAt)}</td>
                  <td className="px-3 py-2 text-xs text-paper-400 dark:text-paper-600">{r.changeNote}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
