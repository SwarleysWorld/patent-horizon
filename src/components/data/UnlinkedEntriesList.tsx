"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ProductPicker, type PickedProduct } from "./ProductPicker";
import { linkUnlinkedEntryAction } from "@/app/data/actions";
import type { UnlinkedManualEntry } from "@/lib/ingestion/manualEntry";

function timeAgo(d: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function UnlinkedRow({ entry }: { entry: UnlinkedManualEntry }) {
  const router = useRouter();
  const [pick, setPick] = useState<PickedProduct | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function link() {
    if (!pick) return;
    setMessage(null);
    startTransition(async () => {
      const res = await linkUnlinkedEntryAction({ entityType: entry.entityType, entityId: entry.id, drugId: pick.id });
      if (res.ok) {
        router.refresh();
      } else {
        setMessage(res.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 border-b border-paper-100 py-2.5 last:border-0 dark:border-paper-900 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm text-paper-900 dark:text-paper-50">{entry.label}</p>
        <p className="text-xs text-paper-400 dark:text-paper-600">
          {entry.entityType === "generic_challenge" ? "Generic challenge" : "Litigation case"} · entered {timeAgo(entry.enteredAt)}
        </p>
      </div>
      <div className="flex items-center gap-2 sm:w-64">
        <div className="flex-1">
          <ProductPicker onSelect={setPick} selected={pick} />
        </div>
        <button
          onClick={link}
          disabled={!pick || isPending}
          className="rounded-md border border-paper-300 px-2 py-1 text-xs font-medium text-paper-700 hover:bg-paper-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-paper-700 dark:text-paper-300 dark:hover:bg-paper-900"
        >
          Link
        </button>
      </div>
      {message && <p className="text-xs text-rust-600 dark:text-rust-400">{message}</p>}
    </div>
  );
}

export function UnlinkedEntriesList({ entries }: { entries: UnlinkedManualEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-paper-900 dark:text-paper-50">
        Unlinked manual entries <span className="font-normal text-paper-400">({entries.length})</span>
      </h2>
      <p className="mb-2 text-xs text-paper-500 dark:text-paper-400">
        Saved without a confirmed product match — link them to the right product below, or leave as-is.
      </p>
      <div className="rounded-lg border border-paper-200 bg-paper-100 px-4 dark:border-paper-800 dark:bg-paper-950">
        {entries.map((entry) => (
          <UnlinkedRow key={`${entry.entityType}-${entry.id}`} entry={entry} />
        ))}
      </div>
    </section>
  );
}
