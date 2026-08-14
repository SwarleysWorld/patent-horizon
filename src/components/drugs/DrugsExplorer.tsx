"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import type { DrugSummary } from "@/lib/drugs/schemas";
import { titleCase } from "@/lib/format";
import { TypeBadge } from "./TypeBadge";
import { EntryDateCell } from "./EntryDateCell";
import { EmptyState } from "./EmptyState";

const HORIZONS: { label: string; days: number | null }[] = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "6 months", days: 180 },
  { label: "1 year", days: 365 },
  { label: "All", days: null },
];

interface Pagination {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

export function DrugsExplorer({ data, pagination }: { data: DrugSummary[]; pagination: Pagination }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const committedQuery = searchParams.get("q") ?? "";
  const [queryDraft, setQueryDraft] = useState(committedQuery);
  const withinDaysParam = searchParams.get("withinDays");
  const activeHorizon = withinDaysParam === null ? null : Number(withinDaysParam);
  const sort = searchParams.get("sort") === "entry_desc" ? "entry_desc" : "entry_asc";

  function navigate(patch: Record<string, string | null>, resetOffset = true) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    if (resetOffset) params.delete("offset");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  // Debounce search input -> URL. Skip the no-op case where the draft
  // already matches what's committed (e.g. right after mount).
  useEffect(() => {
    if (queryDraft === committedQuery) return;
    const handle = setTimeout(() => {
      navigate({ q: queryDraft.trim() || null });
    }, 300);
    return () => clearTimeout(handle);
    // Only re-run when the draft changes — `navigate` and `committedQuery`
    // intentionally aren't deps here, or every keystroke would fire twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDraft]);

  // Power-user shortcut: "/" focuses search, unless already typing somewhere.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !isTyping) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const from = pagination.total === 0 ? 0 : pagination.offset + 1;
  const to = Math.min(pagination.offset + pagination.limit, pagination.total);

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800 dark:bg-black/90">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <svg
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={queryDraft}
              onChange={(e) => setQueryDraft(e.target.value)}
              placeholder="Search brand or generic name…"
              className="w-64 rounded-md border border-zinc-300 bg-white py-1.5 pr-3 pl-8 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-zinc-200 bg-zinc-50 px-1 font-mono text-[10px] text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 sm:block hidden">
              /
            </kbd>
          </div>

          <div className="flex items-center gap-1 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-900">
            {HORIZONS.map((h) => {
              const active = h.days === activeHorizon;
              return (
                <button
                  key={h.label}
                  onClick={() => navigate({ withinDays: h.days === null ? null : String(h.days) })}
                  className={clsx(
                    "rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                    active
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                      : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                  )}
                >
                  {h.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <span
            className={clsx("transition-opacity", isPending ? "opacity-100" : "opacity-0")}
            aria-hidden={!isPending}
          >
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </span>
          <span>
            {pagination.total.toLocaleString()} drug{pagination.total === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {data.length === 0 ? (
        <EmptyState hasFilters={Boolean(committedQuery || activeHorizon !== null)} />
      ) : (
        <div className={clsx("overflow-x-auto transition-opacity", isPending && "opacity-60")}>
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">Drug</th>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 text-right font-medium">Patents</th>
                <th className="px-4 py-2 text-right font-medium">Excl.</th>
                <th className="px-4 py-2 text-right font-medium">
                  <button
                    onClick={() => navigate({ sort: sort === "entry_asc" ? "entry_desc" : "entry_asc" })}
                    className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    Est. Generic Entry
                    <span className="text-zinc-400">{sort === "entry_asc" ? "▲" : "▼"}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((drug) => (
                <tr
                  key={drug.id}
                  onClick={() => router.push(`/drugs/${drug.id}`)}
                  className="cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/60"
                >
                  <td className="px-4 py-2.5">
                    <Link href={`/drugs/${drug.id}`} className="block font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                      {titleCase(drug.brandName)}
                    </Link>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      {titleCase(drug.genericName)} · {drug.strength}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{titleCase(drug.company.name)}</td>
                  <td className="px-4 py-2.5">
                    <TypeBadge type={drug.applicationType} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {drug.patentCount}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {drug.exclusivityCount}
                  </td>
                  <td className="px-4 py-2.5">
                    {drug.estimatedGenericEntryDate && <EntryDateCell date={drug.estimatedGenericEntryDate} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <span>
          {pagination.total === 0
            ? "No results"
            : `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${pagination.total.toLocaleString()}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            disabled={pagination.offset === 0}
            onClick={() => navigate({ offset: String(Math.max(0, pagination.offset - pagination.limit)) }, false)}
            className="rounded border border-zinc-300 px-2.5 py-1 font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Prev
          </button>
          <button
            disabled={!pagination.hasMore}
            onClick={() => navigate({ offset: String(pagination.offset + pagination.limit) }, false)}
            className="rounded border border-zinc-300 px-2.5 py-1 font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
