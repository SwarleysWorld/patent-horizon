"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import type { DrugSummary, FilterOptions } from "@/lib/drugs/schemas";
import type { DrugModality } from "@/lib/classification/modality";
import { titleCase } from "@/lib/format";
import { TypeBadge } from "./TypeBadge";
import { ModalityBadge } from "./ModalityBadge";
import { EntryDateCell } from "./EntryDateCell";
import { EmptyState } from "./EmptyState";

const HORIZONS: { label: string; days: number | null }[] = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "6 months", days: 180 },
  { label: "1 year", days: 365 },
  { label: "All", days: null },
];

// Advanced-search params, distinct from the primary search/horizon params
// above — used to compute the "N active" badge and whether the panel
// should start expanded.
const ADVANCED_PARAMS = ["modality", "drugClass", "applicationType", "dosageForm", "expiresAfter", "expiresBefore"] as const;

interface Pagination {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

export function DrugsExplorer({
  data,
  pagination,
  filterOptions,
}: {
  data: DrugSummary[];
  pagination: Pagination;
  filterOptions: FilterOptions;
}) {
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

  const activeAdvancedCount = ADVANCED_PARAMS.filter((key) => searchParams.get(key) !== null).length;
  const [advancedOpen, setAdvancedOpen] = useState(activeAdvancedCount > 0);

  const modality = searchParams.get("modality") ?? "";
  const drugClass = searchParams.get("drugClass") ?? "";
  const applicationType = searchParams.get("applicationType") ?? "";
  const dosageForm = searchParams.get("dosageForm") ?? "";
  const expiresAfter = searchParams.get("expiresAfter") ?? "";
  const expiresBefore = searchParams.get("expiresBefore") ?? "";

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
  const hasAnyFilter = Boolean(committedQuery || activeHorizon !== null || activeAdvancedCount > 0);

  function clearAdvanced() {
    navigate({
      modality: null,
      drugClass: null,
      applicationType: null,
      dosageForm: null,
      expiresAfter: null,
      expiresBefore: null,
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-black/90">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                placeholder="Search brand, generic, or company…"
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

            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className={clsx(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                advancedOpen || activeAdvancedCount > 0
                  ? "border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
                  : "border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900",
              )}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 8h12M9 12h6M11 16h2" />
              </svg>
              Advanced
              {activeAdvancedCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-zinc-900 px-1 text-[10px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
                  {activeAdvancedCount}
                </span>
              )}
              <svg
                className={clsx("h-3 w-3 transition-transform", advancedOpen && "rotate-180")}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
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

        {advancedOpen && (
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <FilterSelect
              label="Modality"
              value={modality}
              onChange={(v) => navigate({ modality: v || null })}
              options={filterOptions.modalities.map((m) => ({ value: m.value, label: m.label }))}
            />
            <FilterSelect
              label="Drug class"
              value={drugClass}
              onChange={(v) => navigate({ drugClass: v || null })}
              options={filterOptions.drugClasses.map((c) => ({ value: c, label: c }))}
            />
            <FilterSelect
              label="Application type"
              value={applicationType}
              onChange={(v) => navigate({ applicationType: v || null })}
              options={filterOptions.applicationTypes.map((t) => ({ value: t, label: t }))}
            />
            <FilterSelect
              label="Dosage form"
              value={dosageForm}
              onChange={(v) => navigate({ dosageForm: v || null })}
              options={filterOptions.dosageForms.map((f) => ({ value: f, label: titleCase(f) }))}
            />

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Est. entry after</label>
              <input
                type="date"
                value={expiresAfter}
                onChange={(e) => navigate({ expiresAfter: e.target.value || null })}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Est. entry before</label>
              <input
                type="date"
                value={expiresBefore}
                onChange={(e) => navigate({ expiresBefore: e.target.value || null })}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>

            {activeAdvancedCount > 0 && (
              <button
                onClick={clearAdvanced}
                className="rounded-md px-2 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {data.length === 0 ? (
        <EmptyState hasFilters={hasAnyFilter} />
      ) : (
        <div className={clsx("overflow-x-auto transition-opacity", isPending && "opacity-60")}>
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">Drug</th>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Class</th>
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
                  <td className="px-4 py-2.5">
                    <ClassCell modality={drug.modality} drugClass={drug.drugClass} filterOptions={filterOptions} />
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

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-32 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ClassCell({
  modality,
  drugClass,
  filterOptions,
}: {
  modality: DrugModality;
  drugClass: string | null;
  filterOptions: FilterOptions;
}) {
  if (modality !== "SMALL_MOLECULE") {
    const label = filterOptions.modalities.find((m) => m.value === modality)?.label ?? modality;
    return <ModalityBadge modality={modality} label={label} />;
  }
  if (drugClass) {
    return <span className="text-xs text-zinc-500 dark:text-zinc-400">{drugClass}</span>;
  }
  return <span className="text-xs text-zinc-300 dark:text-zinc-700">—</span>;
}
