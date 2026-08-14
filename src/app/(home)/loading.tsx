export default function Loading() {
  return (
    <div className="flex flex-1 flex-col animate-pulse">
      <div className="border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
        <div className="h-5 w-64 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-2 h-4 w-80 rounded bg-zinc-100 dark:bg-zinc-900" />
      </div>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="h-8 w-64 rounded-md bg-zinc-100 dark:bg-zinc-900" />
        <div className="h-8 w-72 rounded-md bg-zinc-100 dark:bg-zinc-900" />
      </div>
      <div className="flex flex-col gap-2 px-4 py-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-9 rounded bg-zinc-100 dark:bg-zinc-900" />
        ))}
      </div>
    </div>
  );
}
