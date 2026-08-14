export function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-24 text-center">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No drugs match these filters</p>
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        {hasFilters
          ? "Try widening the time horizon or clearing the search term."
          : "There's no patent or exclusivity data loaded yet."}
      </p>
    </div>
  );
}
