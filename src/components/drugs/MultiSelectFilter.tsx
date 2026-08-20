"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

export interface MultiSelectOption {
  value: string;
  label: string;
  count?: number;
}

// One reusable control for every advanced-search filter dimension —
// modality, drugClass, applicationType, dosageForm, route, applicant,
// source, patentType, exclusivityCode all use this same component rather
// than a one-off per dimension. A button showing the active count opens a
// popover with a search-to-narrow box (useful once a list gets past a
// couple dozen options, e.g. dosageForm's 117 or exclusivityCode's ~470)
// and a checkbox per option, each annotated with its live facet count when
// one is available (scoped by every OTHER active filter — see
// getFacetCounts) so picking a value shows how many results it would
// actually leave, not just its name.
export function MultiSelectFilter({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  options: MultiSelectOption[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const filteredOptions = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function toggle(value: string) {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1">
      <label className="text-[11px] font-medium text-paper-500 dark:text-paper-400">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "flex min-w-32 items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs",
          values.length > 0
            ? "border-paper-400 bg-paper-50 text-paper-900 dark:border-paper-600 dark:bg-paper-800 dark:text-paper-50"
            : "border-paper-300 bg-paper-100 text-paper-500 dark:border-paper-700 dark:bg-paper-900 dark:text-paper-400",
        )}
      >
        <span>{values.length > 0 ? `${values.length} selected` : "Any"}</span>
        <svg className={clsx("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-20 mt-1 flex max-h-80 w-64 flex-col overflow-hidden rounded-md border border-paper-200 bg-paper-100 shadow-lg dark:border-paper-700 dark:bg-paper-900">
          {options.length > 8 && (
            <div className="border-b border-paper-100 p-1.5 dark:border-paper-800">
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Filter ${label.toLowerCase()}…`}
                className="w-full rounded border border-paper-200 bg-paper-50 px-2 py-1 text-xs text-paper-900 focus:border-paper-400 focus:outline-none dark:border-paper-700 dark:bg-paper-800 dark:text-paper-100"
              />
            </div>
          )}
          <div className="flex-1 overflow-y-auto py-1">
            {filteredOptions.length === 0 && (
              <p className="px-3 py-2 text-xs text-paper-400">No matches.</p>
            )}
            {filteredOptions.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-paper-50 dark:hover:bg-paper-800"
              >
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={values.includes(o.value)}
                    onChange={() => toggle(o.value)}
                    className="h-3.5 w-3.5 rounded border-paper-300 dark:border-paper-600"
                  />
                  <span className="text-paper-700 dark:text-paper-300">{o.label}</span>
                </span>
                {o.count != null && <span className="font-mono tabular-nums text-paper-400">{o.count.toLocaleString()}</span>}
              </label>
            ))}
          </div>
          {values.length > 0 && (
            <div className="border-t border-paper-100 p-1.5 dark:border-paper-800">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full rounded px-2 py-1 text-xs font-medium text-paper-500 hover:bg-paper-50 hover:text-paper-900 dark:hover:bg-paper-800 dark:hover:text-paper-100"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
