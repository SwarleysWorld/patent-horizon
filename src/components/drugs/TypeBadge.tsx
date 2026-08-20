const STYLES: Record<string, string> = {
  NDA: "bg-ledger-50 text-ledger-700 ring-ledger-600/20 dark:bg-ledger-500/10 dark:text-ledger-400 dark:ring-ledger-500/20",
  ANDA: "bg-paper-100 text-paper-600 ring-paper-500/20 dark:bg-paper-500/10 dark:text-paper-400 dark:ring-paper-500/20",
  BLA: "bg-purple-50 text-purple-700 ring-purple-600/20 dark:bg-purple-500/10 dark:text-purple-400 dark:ring-purple-500/20",
};

export function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STYLES[type] ?? STYLES.ANDA}`}
    >
      {type}
    </span>
  );
}
