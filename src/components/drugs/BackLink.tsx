"use client";

import { useRouter } from "next/navigation";

// router.back() preserves whatever filters/sort/scroll position the list
// had — a plain link to "/" would reset the analyst's search.
export function BackLink() {
  const router = useRouter();

  return (
    <button
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/drugs");
      }}
      className="inline-flex items-center gap-1 text-sm text-paper-500 hover:text-paper-900 dark:text-paper-400 dark:hover:text-paper-100"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      Back to results
    </button>
  );
}
