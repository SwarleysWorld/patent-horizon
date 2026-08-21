"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-runs the server fetch on an interval so a long-running background
// process (PTA enrichment can take hours) shows moving progress on this
// page without anyone having to manually reload it every few minutes.
// `fast` tightens the interval while a pipeline is actively RUNNING, so a
// quick (~seconds) ingestion run's status change is visible without
// waiting out a full 20s tick.
export function AutoRefresh({ intervalMs, fast = false }: { intervalMs?: number; fast?: boolean }) {
  const effectiveIntervalMs = intervalMs ?? (fast ? 4_000 : 20_000);
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), effectiveIntervalMs);
    return () => clearInterval(id);
  }, [router, effectiveIntervalMs]);

  return null;
}
