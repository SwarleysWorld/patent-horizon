"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-runs the server fetch on an interval so a long-running background
// process (PTA enrichment can take hours) shows moving progress on this
// page without anyone having to manually reload it every few minutes.
export function AutoRefresh({ intervalMs = 20_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
