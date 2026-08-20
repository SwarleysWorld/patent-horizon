export function ProgressBar({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.min(100, (done / total) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-paper-700 dark:text-paper-300">{label}</span>
        <span className="font-mono tabular-nums text-paper-500 dark:text-paper-400">
          {done.toLocaleString()} / {total.toLocaleString()} ({pct.toFixed(1)}%)
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-paper-100 dark:bg-paper-800">
        <div
          className="h-full rounded-full bg-statute-500 transition-[width] dark:bg-statute-400"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
