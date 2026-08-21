"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type TriggerPipelineKey = "orange_book" | "purple_book" | "paragraph_iv" | "pta" | "all";

// POSTs to the Analyst-only /api/data/ingest route and asks the page to
// re-fetch immediately on success, rather than waiting for AutoRefresh's
// next 20s tick. The `disabled` prop (driven by the page's own
// IngestionRun status read) plus this component's own `pending` state
// during the fetch itself are both belt-and-suspenders against a rapid-
// click burst — the real guard is server-side, in the orchestrator.
export function TriggerButton({
  pipeline,
  disabled,
  label,
}: {
  pipeline: TriggerPipelineKey;
  disabled: boolean;
  label: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/data/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline }),
      });
      if (res.status === 202) {
        router.refresh();
      } else {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setMessage(body?.error?.message ?? `Failed to start (HTTP ${res.status}).`);
      }
    } catch {
      setMessage("Network error — try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={onClick}
        disabled={disabled || pending}
        className="rounded-md border border-paper-200 px-2 py-1 text-xs font-medium text-paper-700 hover:bg-paper-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-paper-800 dark:text-paper-300 dark:hover:bg-paper-900"
      >
        {pending ? "Starting…" : disabled ? "Running…" : label}
      </button>
      {message && <span className="max-w-[160px] text-right text-[11px] text-flag-700 dark:text-flag-400">{message}</span>}
    </div>
  );
}
