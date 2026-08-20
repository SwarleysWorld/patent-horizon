export function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-24 text-center">
      <p className="text-sm font-medium text-paper-700 dark:text-paper-300">No drugs match these filters</p>
      <p className="text-sm text-paper-500 dark:text-paper-500">
        {hasFilters
          ? "Try widening the time horizon, or clearing the search term and advanced filters."
          : "There's no patent or exclusivity data loaded yet."}
      </p>
    </div>
  );
}
