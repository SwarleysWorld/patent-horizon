const STYLES: Record<string, string> = {
  orange_book: "bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/20",
  purple_book: "bg-purple-50 text-purple-700 ring-purple-600/20 dark:bg-purple-500/10 dark:text-purple-400 dark:ring-purple-500/20",
};

const LABELS: Record<string, string> = { orange_book: "Orange Book", purple_book: "Purple Book" };

export function SourceBadge({ source }: { source: string }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STYLES[source] ?? STYLES.orange_book}`}>
      {LABELS[source] ?? source}
    </span>
  );
}
