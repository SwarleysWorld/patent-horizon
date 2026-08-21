// Cancellation for a single IngestionRun, backed by that row's own
// cancelRequested column rather than an in-memory flag.
//
// An in-memory Map/Set keyed by pipeline name looked simpler at first, but
// Next's dev bundler can give two different route files — the trigger
// route and the stop route both import orchestrator.ts, which is what
// pulls this module in — separately bundled copies of the same shared
// module. Confirmed directly: a Stop call returned 202, but the run
// finished normally 40 seconds later having never seen the flag flip,
// because `requestCancel` in one copy's module-scope Set was invisible to
// `isCancelRequested` reading a different copy's Set in the process
// actually running the pipeline. The database is the one thing both
// routes are already proven to share reliably, so cancellation lives
// there instead — one boolean column on the run's own row, checked with a
// real query each time rather than trusted from memory.

import { prisma } from "@/lib/prisma";

export async function requestCancel(runId: string): Promise<void> {
  await prisma.ingestionRun.update({ where: { id: runId }, data: { cancelRequested: true } });
}

export async function isCancelRequested(runId: string): Promise<boolean> {
  const run = await prisma.ingestionRun.findUnique({ where: { id: runId }, select: { cancelRequested: true } });
  return run?.cancelRequested ?? false;
}

// PTA and litigation process one candidate at a time with a real await
// between each (see each pipeline's own run loop) — cheap to check this
// there. Orange Book/Purple Book/Paragraph IV instead run as a handful of
// monolithic fetch → parse → load phases with no natural per-item loop, so
// they use this exception-based style at each phase boundary instead:
// throwIfCancelled() between phases, and abortSignalFor()'s signal passed
// into the phase's own fetch() so a Stop click can interrupt a slow
// download mid-flight rather than only being noticed once it finishes.
export class RunCancelledError extends Error {
  constructor() {
    super("Stopped by request.");
    this.name = "RunCancelledError";
  }
}

export async function throwIfCancelled(runId: string): Promise<void> {
  if (await isCancelRequested(runId)) throw new RunCancelledError();
}

// A run's catch block uses this to tell "the user stopped it" apart from
// an actual failure, so it writes CANCELLED instead of FAILED.
export function statusForError(error: unknown): "CANCELLED" | "FAILED" {
  return error instanceof RunCancelledError ? "CANCELLED" : "FAILED";
}

// Ties an AbortController to a run's cancelRequested column via a short
// poll (this is a rare, latency-insensitive user action — a 500ms DB poll
// is plenty responsive without adding any pub/sub machinery, and cheap
// enough not to matter against a fetch that's already going to take
// seconds). Always call the returned `stop()` once the fetch settles,
// success or failure, or the interval leaks for the rest of the process's
// life.
export function abortSignalFor(runId: string): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  const interval = setInterval(() => {
    isCancelRequested(runId)
      .then((cancelled) => {
        if (cancelled) controller.abort();
      })
      .catch(() => {
        // A transient DB hiccup here shouldn't abort an otherwise-healthy
        // fetch — just skip this poll and try again on the next tick.
      });
  }, 500);
  return { signal: controller.signal, stop: () => clearInterval(interval) };
}
