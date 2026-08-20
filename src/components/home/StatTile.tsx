import clsx from "clsx";

export function StatTile({
  label,
  value,
  caption,
  accent = "ink",
}: {
  label: string;
  value: string;
  caption?: string;
  accent?: "ink" | "rust" | "flag" | "statute";
}) {
  const accentClass = {
    ink: "text-paper-900 dark:text-paper-50",
    rust: "text-rust-700 dark:text-rust-400",
    flag: "text-flag-700 dark:text-flag-400",
    statute: "text-statute-700 dark:text-statute-400",
  }[accent];

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-paper-200 bg-paper-100 p-4 dark:border-paper-800 dark:bg-paper-900">
      <span className="text-xs font-medium tracking-wide text-paper-500 uppercase dark:text-paper-400">{label}</span>
      <span className={clsx("font-mono text-2xl font-semibold tabular-nums", accentClass)}>{value}</span>
      {caption && <span className="text-xs text-paper-500 dark:text-paper-400">{caption}</span>}
    </div>
  );
}
