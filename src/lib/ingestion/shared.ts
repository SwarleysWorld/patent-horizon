// Small helpers shared by all three fast ingestion pipelines
// (orangeBook/load.ts, purpleBook/load.ts, paragraphIV/load.ts) —
// extracted here once a second pipeline needed the exact same logic,
// rather than kept speculative/duplicated.

import { RunCancelledError } from "./cancellation";

// Keeps concurrent DB round-trips bounded well under the `pg` pool's
// default max (10), so this can run alongside other connections without
// starving the pool.
export const DEFAULT_INGESTION_CONCURRENCY = 6;

// `signal`, when given, is checked synchronously (cheap — no DB round trip
// per item) before starting each item, so a Stop click during a load pass
// of tens of thousands of rows is noticed within roughly one item's
// latency rather than only once the whole pass finishes. See
// cancellation.ts's abortSignalFor — that's what's passed in here, the
// same AbortSignal already wired to the pipeline's own fetch() calls, so
// one signal covers the whole run rather than one per phase.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      if (signal?.aborted) throw new RunCancelledError();
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Source files can contain literal duplicate rows (same natural key,
// byte-for-byte) — confirmed in Orange Book's exclusivity.txt on real
// data. Two concurrent upsert() calls racing on the same not-yet-existing
// key can both attempt an INSERT and one loses with a unique-violation,
// since upsert isn't atomic across concurrent callers. Deduping by natural
// key before the concurrent pass avoids the race entirely, and is also
// just correct: a row repeated verbatim in the source carries no extra
// information the second occurrence would add.
export function dedupeByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
