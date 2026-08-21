"use client";

import { useEffect, useState } from "react";
import { titleCase } from "@/lib/format";
import { SourceBadge } from "@/components/drugs/SourceBadge";

interface AutocompleteSuggestion {
  id: string;
  source: "orange_book" | "purple_book";
  name: string;
  alternateName: string;
}

export interface PickedProduct {
  id: string;
  source: "orange_book" | "purple_book";
  name: string;
}

// Reuses GET /api/search/autocomplete as-is (same debounce/dropdown shell
// as DrugsExplorer.tsx's search box) but stores the picked {id, source}
// into the caller's form state via onSelect, instead of navigating.
//
// Known limitation, inherited from the endpoint itself: autocomplete
// DISTINCT-ONs by name, so a brand name with many strength/presentation
// rows (e.g. Humira) collapses to one arbitrarily-chosen row's id. For
// attaching a fact to a SPECIFIC strength, an Analyst may need to confirm
// via the product's own detail page rather than trust the picker alone —
// acceptable for a first pass, not silently pretended away.
export function ProductPicker({ onSelect, selected }: { onSelect: (product: PickedProduct) => void; selected: PickedProduct | null }) {
  const [query, setQuery] = useState(selected?.name ?? "");
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (selected && query === selected.name) return;
    const handle = setTimeout(() => {
      if (query.trim().length === 0) {
        setSuggestions([]);
        setOpen(false);
        return;
      }
      fetch(`/api/search/autocomplete?q=${encodeURIComponent(query.trim())}`)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((body) => {
          setSuggestions(body.data ?? []);
          setOpen(true);
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(handle);
  }, [query, selected]);

  function pick(s: AutocompleteSuggestion) {
    setQuery(s.name);
    setOpen(false);
    onSelect({ id: s.id, source: s.source, name: s.name });
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder="Search for a product…"
        className="w-full rounded-md border border-paper-300 bg-paper-50 px-2 py-1.5 text-sm text-paper-900 focus:border-statute-500 focus:ring-1 focus:ring-statute-500 focus:outline-none dark:border-paper-700 dark:bg-paper-900 dark:text-paper-100"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute top-full left-0 z-20 mt-1 w-full overflow-hidden rounded-md border border-paper-200 bg-paper-100 shadow-lg dark:border-paper-700 dark:bg-paper-900">
          {suggestions.map((s) => (
            <button
              key={`${s.source}-${s.id}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
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
      {selected && (
        <p className="mt-1 text-xs text-statute-700 dark:text-statute-400">
          Selected: {titleCase(selected.name)} ({selected.source === "orange_book" ? "Orange Book" : "Purple Book"})
        </p>
      )}
    </div>
  );
}
