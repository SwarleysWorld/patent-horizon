"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type StoppablePipelineKey = "orange_book" | "purple_book" | "paragraph_iv" | "pta" | "litigation";

// Only rendered next to a pipeline that's actually RUNNING (see SourceCard
// and the /data page's PTA section) — POSTs to /api/data/ingest/stop,
// which just sets an in-memory flag the pipeline's own loop checks between
// candidates (see cancellation.ts). That means this doesn't stop anything
// instantly: the run finishes its current in-flight request first, same
// order of latency as the request itself (seconds for litigation, up to a
// few seconds for PTA), then writes a CANCELLED row and exits on its own.
export function StopButton({ pipeline }: { pipeline: StoppablePipelineKey }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/data/ingest/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline }),
      });
      if (res.status === 202) {
        router.refresh();
      } else {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setMessage(body?.error?.message ?? `Failed to stop (HTTP ${res.status}).`);
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
        disabled={pending}
        className="rounded-md border border-rust-200 px-2 py-1 text-xs font-medium text-rust-700 hover:bg-rust-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rust-800 dark:text-rust-400 dark:hover:bg-rust-950"
      >
        {pending ? "Stopping…" : "Stop"}
      </button>
      {message && <span className="max-w-[160px] text-right text-[11px] text-flag-700 dark:text-flag-400">{message}</span>}
    </div>
  );
}
