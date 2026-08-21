"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import type { SearchResult, FilterOptions } from "@/lib/drugs/schemas";
import type { Modality } from "@/lib/classification/modality";
import { titleCase } from "@/lib/format";
import { TypeBadge } from "./TypeBadge";
import { LicenseTypeBadge } from "./LicenseTypeBadge";
import { SourceBadge } from "./SourceBadge";
import { ModalityBadge } from "./ModalityBadge";
import { EntryDateCell } from "./EntryDateCell";
import { PtaGapCell } from "./PtaGapCell";
import { EmptyState } from "./EmptyState";
import { MultiSelectFilter } from "./MultiSelectFilter";

const HORIZONS: { label: string; days: number | null }[] = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "6 months", days: 180 },
  { label: "1 year", days: 365 },
  { label: "All", days: null },
];

// Every multi-value filter dimension, in the order they render in the
// Advanced panel — also what powers the "N active" count on the toggle
// button and what a bare "Clear" wipes.
const MULTI_FILTER_KEYS = [
  "modality",
  "drugClass",
  "applicationType",
  "dosageForm",
  "route",
  "applicant",
  "source",
  "patentType",
  "exclusivityCode",
] as const;
const OTHER_ADVANCED_KEYS = [
  "expiresAfter",
  "expiresBefore",
  "minPtaGapDays",
  "hasGenericChallenge",
  "hasFirstCommercialMarketingDate",
  "hasLitigation",
] as const;

// Must match EXPORT_ROW_CAP in src/app/api/drugs/export/route.ts — kept
// as a separate constant (not fetched) since it's static and this avoids
// a round-trip just to know whether to show the truncation notice.
const EXPORT_ROW_CAP = 500;

interface Pagination {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

interface Facets {
  [dimension: string]: { value: string; count: number }[];
}

type AutocompleteSuggestion = { id: string; source: string; name: string; alternateName: string };

function getCsv(searchParams: URLSearchParams, key: string): string[] {
  const raw = searchParams.get(key);
  return raw ? raw.split(",").filter(Boolean) : [];
}

export function DrugsExplorer({
  data,
  pagination,
  filterOptions,
  facets,
}: {
  data: SearchResult[];
  pagination: Pagination;
  filterOptions: FilterOptions;
  facets: Facets;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const committedQuery = searchParams.get("q") ?? "";
  const [queryDraft, setQueryDraft] = useState(committedQuery);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const withinDaysParam = searchParams.get("withinDays");
  const activeHorizon = withinDaysParam === null ? null : Number(withinDaysParam);
  const sort = (searchParams.get("sort") as "entry_asc" | "entry_desc" | "pta_gap_desc") || "entry_asc";

  const activeAdvancedCount =
    MULTI_FILTER_KEYS.filter((k) => getCsv(searchParams, k).length > 0).length +
    OTHER_ADVANCED_KEYS.filter((k) => searchParams.get(k) !== null).length;
  const [advancedOpen, setAdvancedOpen] = useState(activeAdvancedCount > 0);

  const expiresAfter = searchParams.get("expiresAfter") ?? "";
  const expiresBefore = searchParams.get("expiresBefore") ?? "";
  const minPtaGapDays = searchParams.get("minPtaGapDays") ?? "";
  const hasGenericChallenge = searchParams.get("hasGenericChallenge") === "true";
  const hasFirstCommercialMarketingDate = searchParams.get("hasFirstCommercialMarketingDate") === "true";
  const hasLitigation = searchParams.get("hasLitigation") === "true";

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

  function setMultiFilter(key: string, values: string[]) {
    navigate({ [key]: values.length > 0 ? values.join(",") : null });
  }

  // Debounce search input -> committed URL param + autocomplete
  // suggestions. Skip the no-op case where the draft already matches
  // what's committed (e.g. right after mount).
  useEffect(() => {
    if (queryDraft === committedQuery) return;
    const handle = setTimeout(() => {
      navigate({ q: queryDraft.trim() || null });
      if (queryDraft.trim().length > 0) {
        fetch(`/api/search/autocomplete?q=${encodeURIComponent(queryDraft.trim())}`)
          .then((r) => (r.ok ? r.json() : { data: [] }))
          .then((body) => {
            setSuggestions(body.data ?? []);
            setSuggestionsOpen(true);
          })
          .catch(() => {});
      } else {
        setSuggestions([]);
        setSuggestionsOpen(false);
      }
    }, 300);
    return () => clearTimeout(handle);
    // Only re-run when the draft changes — `navigate` and `committedQuery`
    // intentionally aren't deps here, or every keystroke would fire twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDraft]);

  function selectSuggestion(s: AutocompleteSuggestion) {
    setQueryDraft(s.name);
    setSuggestionsOpen(false);
    navigate({ q: s.name });
  }

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
    const patch: Record<string, null> = {};
    for (const key of MULTI_FILTER_KEYS) patch[key] = null;
    for (const key of OTHER_ADVANCED_KEYS) patch[key] = null;
    navigate(patch);
  }

  function facetOptions(dimension: string, baseOptions: { value: string; label: string }[]) {
    const counts = new Map((facets[dimension] ?? []).map((f) => [f.value, f.count]));
    return baseOptions.map((o) => ({ ...o, count: counts.get(o.value) }));
  }

  function detailHref(row: SearchResult): string {
    return row.source === "purple_book" ? `/biologics/${row.id}` : `/drugs/${row.id}`;
  }

  const exportHref = `/api/drugs/export?${searchParams.toString()}`;

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-paper-200 bg-background/90 px-4 py-3 backdrop-blur dark:border-paper-800 dark:bg-background/90">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <svg
                className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-paper-400"
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
                onFocus={() => suggestions.length > 0 && setSuggestionsOpen(true)}
                onBlur={() => setTimeout(() => setSuggestionsOpen(false), 150)}
                placeholder="Search brand, generic, or company…"
                className="w-64 rounded-md border border-paper-300 bg-paper-100 py-1.5 pr-3 pl-8 text-sm text-paper-900 placeholder:text-paper-400 focus:border-paper-500 focus:ring-1 focus:ring-paper-500 focus:outline-none dark:border-paper-700 dark:bg-paper-900 dark:text-paper-100"
              />
              <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-paper-200 bg-paper-50 px-1 font-mono text-[10px] text-paper-400 dark:border-paper-700 dark:bg-paper-800 sm:block hidden">
                /
              </kbd>

              {suggestionsOpen && suggestions.length > 0 && (
                <div className="absolute top-full left-0 z-20 mt-1 w-72 overflow-hidden rounded-md border border-paper-200 bg-paper-100 shadow-lg dark:border-paper-700 dark:bg-paper-900">
                  {suggestions.map((s) => (
                    <button
                      key={`${s.source}-${s.id}`}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectSuggestion(s)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-paper-50 dark:hover:bg-paper-800"
                    >
                      <span>
                        <span className="font-medium text-paper-900 dark:text-paper-50">{titleCase(s.name)}</span>{" "}
                        <span className="text-paper-400">{titleCase(s.alternateName)}</span>
                      </span>
                      <SourceBadge source={s.source} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 rounded-md bg-paper-100 p-0.5 dark:bg-paper-900">
              {HORIZONS.map((h) => {
                const active = h.days === activeHorizon;
                return (
                  <button
                    key={h.label}
                    onClick={() => navigate({ withinDays: h.days === null ? null : String(h.days) })}
                    className={clsx(
                      "rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                      active
                        ? "bg-paper-100 text-paper-900 shadow-sm dark:bg-paper-700 dark:text-paper-50"
                        : "text-paper-500 hover:text-paper-900 dark:text-paper-400 dark:hover:text-paper-100",
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
                  ? "border-paper-400 bg-paper-100 text-paper-900 dark:border-paper-600 dark:bg-paper-800 dark:text-paper-50"
                  : "border-paper-300 text-paper-600 hover:bg-paper-50 dark:border-paper-700 dark:text-paper-400 dark:hover:bg-paper-900",
              )}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 8h12M9 12h6M11 16h2" />
              </svg>
              Advanced
              {activeAdvancedCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-paper-900 px-1 text-[10px] font-semibold text-paper-50 dark:bg-paper-100 dark:text-paper-900">
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

            <a
              href={exportHref}
              className="flex items-center gap-1.5 rounded-md border border-paper-300 px-2.5 py-1.5 text-xs font-medium text-paper-600 hover:bg-paper-50 dark:border-paper-700 dark:text-paper-400 dark:hover:bg-paper-900"
              title="Export the current filtered results as CSV"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13m0 0l-4-4m4 4l4-4M5 19h14" />
              </svg>
              Export CSV
            </a>
            {pagination.total > EXPORT_ROW_CAP && (
              <span
                className="text-[11px] text-paper-500 dark:text-paper-400"
                title={`Export includes the top ${EXPORT_ROW_CAP} of ${pagination.total.toLocaleString()} matches, ranked the same way as this list`}
              >
                top {EXPORT_ROW_CAP} of {pagination.total.toLocaleString()}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-paper-500 dark:text-paper-400">
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
              {pagination.total.toLocaleString()} result{pagination.total === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {advancedOpen && (
          <div className="flex flex-col gap-3 rounded-md border border-paper-200 bg-paper-50/60 p-3 dark:border-paper-800 dark:bg-paper-900/40">
            <div className="flex flex-wrap items-end gap-3">
              <MultiSelectFilter
                label="Modality"
                values={getCsv(searchParams, "modality")}
                onChange={(v) => setMultiFilter("modality", v)}
                options={facetOptions("modality", filterOptions.modalities)}
              />
              <MultiSelectFilter
                label="Drug class"
                values={getCsv(searchParams, "drugClass")}
                onChange={(v) => setMultiFilter("drugClass", v)}
                options={filterOptions.drugClasses.map((c) => ({ value: c, label: c }))}
              />
              <MultiSelectFilter
                label="Application type"
                values={getCsv(searchParams, "applicationType")}
                onChange={(v) => setMultiFilter("applicationType", v)}
                options={facetOptions("applicationType", filterOptions.applicationTypes.map((t) => ({ value: t, label: t })))}
              />
              <MultiSelectFilter
                label="Source"
                values={getCsv(searchParams, "source")}
                onChange={(v) => setMultiFilter("source", v)}
                options={facetOptions("source", filterOptions.sources)}
              />
              <MultiSelectFilter
                label="Patent type"
                values={getCsv(searchParams, "patentType")}
                onChange={(v) => setMultiFilter("patentType", v)}
                options={filterOptions.patentTypes}
              />
              <MultiSelectFilter
                label="Dosage form"
                values={getCsv(searchParams, "dosageForm")}
                onChange={(v) => setMultiFilter("dosageForm", v)}
                options={facetOptions("dosageForm", filterOptions.dosageForms.map((f) => ({ value: f, label: titleCase(f) })))}
              />
              <MultiSelectFilter
                label="Route"
                values={getCsv(searchParams, "route")}
                onChange={(v) => setMultiFilter("route", v)}
                options={facetOptions("route", filterOptions.routes.map((r) => ({ value: r, label: titleCase(r) })))}
              />
              <MultiSelectFilter
                label="Applicant"
                values={getCsv(searchParams, "applicant")}
                onChange={(v) => setMultiFilter("applicant", v)}
                options={filterOptions.applicants.map((a) => ({ value: a, label: titleCase(a) }))}
              />
              <MultiSelectFilter
                label="Exclusivity code"
                values={getCsv(searchParams, "exclusivityCode")}
                onChange={(v) => setMultiFilter("exclusivityCode", v)}
                options={filterOptions.exclusivityCodes.map((c) => ({ value: c, label: c }))}
              />
            </div>

            <div className="flex flex-wrap items-end gap-3 border-t border-paper-200 pt-3 dark:border-paper-800">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-paper-500 dark:text-paper-400">Est. entry after</label>
                <input
                  type="date"
                  value={expiresAfter}
                  onChange={(e) => navigate({ expiresAfter: e.target.value || null })}
                  className="rounded-md border border-paper-300 bg-paper-100 px-2 py-1 text-xs text-paper-900 focus:border-paper-500 focus:ring-1 focus:ring-paper-500 focus:outline-none dark:border-paper-700 dark:bg-paper-900 dark:text-paper-100"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-paper-500 dark:text-paper-400">Est. entry before</label>
                <input
                  type="date"
                  value={expiresBefore}
                  onChange={(e) => navigate({ expiresBefore: e.target.value || null })}
                  className="rounded-md border border-paper-300 bg-paper-100 px-2 py-1 text-xs text-paper-900 focus:border-paper-500 focus:ring-1 focus:ring-paper-500 focus:outline-none dark:border-paper-700 dark:bg-paper-900 dark:text-paper-100"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-1 text-[11px] font-medium text-statute-700 dark:text-statute-400">
                  Min. PTA gap (days)
                </label>
                <input
                  type="number"
                  min={0}
                  value={minPtaGapDays}
                  onChange={(e) => navigate({ minPtaGapDays: e.target.value || null })}
                  placeholder="e.g. 180"
                  className="w-28 rounded-md border border-statute-300 bg-paper-100 px-2 py-1 text-xs text-paper-900 focus:border-statute-500 focus:ring-1 focus:ring-statute-500 focus:outline-none dark:border-statute-700 dark:bg-paper-900 dark:text-paper-100"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-paper-500 dark:text-paper-400">Generic challenge</label>
                <div className="flex items-center gap-3 pt-1">
                  <label className="flex items-center gap-1.5 text-xs text-paper-700 dark:text-paper-300">
                    <input
                      type="checkbox"
                      checked={hasGenericChallenge}
                      onChange={(e) => navigate({ hasGenericChallenge: e.target.checked ? "true" : null })}
                      className="rounded border-paper-300 dark:border-paper-700"
                    />
                    Has a challenge
                  </label>
                  <label
                    className="flex items-center gap-1.5 text-xs text-paper-700 dark:text-paper-300"
                    title="A generic has actually begun commercial marketing, per FDA's Paragraph IV list — independent of whether a 180-day exclusivity decision has been made"
                  >
                    <input
                      type="checkbox"
                      checked={hasFirstCommercialMarketingDate}
                      onChange={(e) => navigate({ hasFirstCommercialMarketingDate: e.target.checked ? "true" : null })}
                      className="rounded border-paper-300 dark:border-paper-700"
                    />
                    Generic on market
                  </label>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-paper-500 dark:text-paper-400">Litigation</label>
                <div className="flex items-center gap-3 pt-1">
                  <label
                    className="flex items-center gap-1.5 text-xs text-paper-700 dark:text-paper-300"
                    title="Has federal Hatch-Waxman litigation on record (District of Delaware / District of New Jersey, from CourtListener's RECAP archive)"
                  >
                    <input
                      type="checkbox"
                      checked={hasLitigation}
                      onChange={(e) => navigate({ hasLitigation: e.target.checked ? "true" : null })}
                      className="rounded border-paper-300 dark:border-paper-700"
                    />
                    Has litigation
                  </label>
                </div>
              </div>

              {activeAdvancedCount > 0 && (
                <button
                  onClick={clearAdvanced}
                  className="rounded-md px-2 py-1.5 text-xs font-medium text-paper-500 hover:text-paper-900 dark:text-paper-400 dark:hover:text-paper-100"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {data.length === 0 ? (
        <EmptyState hasFilters={hasAnyFilter} />
      ) : (
        <div className={clsx("transition-opacity", isPending && "opacity-60")}>
          <p className="px-4 pt-3 text-xs text-paper-500 dark:text-paper-400">
            Dates flagged{" "}
            <span className="rounded bg-flag-50 px-1 py-0.5 font-medium text-flag-700 dark:bg-flag-500/10 dark:text-flag-400">
              Pending
            </span>{" "}
            haven&apos;t been checked against USPTO records yet and may still move — everything else is either an FDA
            exclusivity date or a USPTO-verified patent expiry.
          </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-paper-200 text-left text-xs text-paper-500 dark:border-paper-800 dark:text-paper-400">
                <th className="px-4 py-2 font-medium">Result</th>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Class</th>
                <th className="px-4 py-2 text-right font-medium">Patents</th>
                <th className="px-4 py-2 text-right font-medium">Excl.</th>
                <th className="px-4 py-2 text-right font-medium">
                  <button
                    onClick={() => navigate({ sort: "pta_gap_desc" })}
                    className={clsx(
                      "inline-flex items-center gap-1 hover:text-paper-900 dark:hover:text-paper-100",
                      sort === "pta_gap_desc" && "text-statute-700 dark:text-statute-400",
                    )}
                    title="Sort by biggest USPTO Patent Term Adjustment gap"
                  >
                    PTA Gap
                    {sort === "pta_gap_desc" && <span>▼</span>}
                  </button>
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  <button
                    onClick={() => navigate({ sort: sort === "entry_asc" ? "entry_desc" : "entry_asc" })}
                    className={clsx(
                      "inline-flex items-center gap-1 hover:text-paper-900 dark:hover:text-paper-100",
                      sort !== "pta_gap_desc" && "text-paper-900 dark:text-paper-100",
                    )}
                  >
                    Est. Generic Entry
                    {sort !== "pta_gap_desc" && <span className="text-paper-400">{sort === "entry_asc" ? "▲" : "▼"}</span>}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => router.push(detailHref(row))}
                  className="cursor-pointer border-b border-paper-100 last:border-0 hover:bg-paper-50 dark:border-paper-900 dark:hover:bg-paper-900/60"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Link href={detailHref(row)} className="font-medium text-paper-900 hover:underline dark:text-paper-50">
                        {titleCase(row.name)}
                      </Link>
                      {row.hasGenericChallenge && (
                        <span
                          className="inline-flex items-center rounded bg-ledger-50 px-1 py-0.5 text-[10px] font-medium text-ledger-700 dark:bg-ledger-500/10 dark:text-ledger-400"
                          title="Has a filed FDA Paragraph IV generic-challenge on record"
                        >
                          Challenge
                        </span>
                      )}
                      {row.hasLitigation && (
                        <span
                          className="inline-flex items-center rounded bg-rust-50 px-1 py-0.5 text-[10px] font-medium text-rust-700 dark:bg-rust-500/10 dark:text-rust-400"
                          title="Has federal Hatch-Waxman litigation on record (District of Delaware / District of New Jersey)"
                        >
                          Litigation
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-paper-500 dark:text-paper-400">
                      {titleCase(row.alternateName)} · {row.strength}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-paper-600 dark:text-paper-400">{titleCase(row.company.name)}</td>
                  <td className="px-4 py-2.5">
                    <SourceBadge source={row.source} />
                  </td>
                  <td className="px-4 py-2.5">
                    {row.applicationType && <TypeBadge type={row.applicationType} />}
                    {row.licenseType && <LicenseTypeBadge licenseType={row.licenseType} />}
                  </td>
                  <td className="px-4 py-2.5">
                    <ClassCell modality={row.modality} drugClass={row.drugClass} filterOptions={filterOptions} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-paper-600 dark:text-paper-400">
                    {row.patentCount}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-paper-600 dark:text-paper-400">
                    {row.exclusivityCount}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <PtaGapCell days={row.maxPtaGapDays} patentCount={row.patentCount} />
                  </td>
                  <td className="px-4 py-2.5">
                    {row.estimatedGenericEntryDate && (
                      <EntryDateCell date={row.estimatedGenericEntryDate} confidence={row.dateConfidence} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-paper-200 px-4 py-3 text-xs text-paper-500 dark:border-paper-800 dark:text-paper-400">
        <span>
          {pagination.total === 0
            ? "No results"
            : `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${pagination.total.toLocaleString()}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            disabled={pagination.offset === 0}
            onClick={() => navigate({ offset: String(Math.max(0, pagination.offset - pagination.limit)) }, false)}
            className="rounded border border-paper-300 px-2.5 py-1 font-medium text-paper-700 hover:bg-paper-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-paper-700 dark:text-paper-300 dark:hover:bg-paper-900"
          >
            Prev
          </button>
          <button
            disabled={!pagination.hasMore}
            onClick={() => navigate({ offset: String(pagination.offset + pagination.limit) }, false)}
            className="rounded border border-paper-300 px-2.5 py-1 font-medium text-paper-700 hover:bg-paper-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-paper-700 dark:text-paper-300 dark:hover:bg-paper-900"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function ClassCell({
  modality,
  drugClass,
  filterOptions,
}: {
  modality: Modality;
  drugClass: string | null;
  filterOptions: FilterOptions;
}) {
  if (modality !== "SMALL_MOLECULE" && modality !== "UNCLASSIFIED") {
    const label = filterOptions.modalities.find((m) => m.value === modality)?.label ?? modality;
    return <ModalityBadge modality={modality} label={label} />;
  }
  if (drugClass) {
    return <span className="text-xs text-paper-500 dark:text-paper-400">{drugClass}</span>;
  }
  if (modality === "UNCLASSIFIED") {
    return <span className="text-xs text-paper-300 dark:text-paper-700" title="No confident classification">Unclassified</span>;
  }
  return <span className="text-xs text-paper-300 dark:text-paper-700">—</span>;
}
