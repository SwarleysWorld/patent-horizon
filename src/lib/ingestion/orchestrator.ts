// The single place that knows about all four ingestion pipelines and owns
// the "don't start a second concurrent run of the same pipeline" guard.
// Triggered from src/app/api/data/ingest/route.ts — see that file for the
// auth/role gate, which is the real security boundary; this module only
// deals with concurrency and background execution.

import { prisma } from "@/lib/prisma";
import { runOrangeBookIngestion, ORANGE_BOOK_SOURCE_NAME } from "./orangeBook";
import { runPurpleBookIngestion, PURPLE_BOOK_SOURCE_NAME } from "./purpleBook";
import { runParagraphIVIngestion, PARAGRAPH_IV_SOURCE_NAME } from "./paragraphIV";
import { runPtaEnrichment, PTA_SOURCE_NAME } from "./pta";
import { runLitigationIngestion, LITIGATION_SOURCE_NAME, runComplaintEnrichment, LITIGATION_COMPLAINT_SOURCE_NAME } from "./litigation";
import { runSettlementsIngestion, SETTLEMENTS_SOURCE_NAME } from "./settlements";
import { requestCancel } from "./cancellation";

export type PipelineKey = "orange_book" | "purple_book" | "paragraph_iv" | "pta" | "litigation" | "litigation_complaints" | "settlements";

// Every pipeline checks the cancellation flag mid-run now (see each
// pipeline's own run loop and cancellation.ts): PTA and litigation check a
// boolean between candidates in their per-item loop; Orange Book/Purple
// Book/Paragraph IV instead check between their fetch/parse/load phases
// and tie an AbortController to the same flag for their fetch() calls, so
// a Stop click can interrupt even a slow download rather than only being
// noticed once the whole run finishes.
const CANCELLABLE_PIPELINES: ReadonlySet<PipelineKey> = new Set<PipelineKey>([
  "orange_book",
  "purple_book",
  "paragraph_iv",
  "pta",
  "litigation",
  "litigation_complaints",
  "settlements",
]);

const PIPELINES: Record<PipelineKey, { sourceName: string; run: () => Promise<{ status: string }> }> = {
  orange_book: { sourceName: ORANGE_BOOK_SOURCE_NAME, run: () => runOrangeBookIngestion() },
  purple_book: { sourceName: PURPLE_BOOK_SOURCE_NAME, run: () => runPurpleBookIngestion() },
  paragraph_iv: { sourceName: PARAGRAPH_IV_SOURCE_NAME, run: () => runParagraphIVIngestion() },
  pta: { sourceName: PTA_SOURCE_NAME, run: () => runPtaEnrichment() },
  litigation: { sourceName: LITIGATION_SOURCE_NAME, run: () => runLitigationIngestion() },
  litigation_complaints: { sourceName: LITIGATION_COMPLAINT_SOURCE_NAME, run: () => runComplaintEnrichment() },
  settlements: { sourceName: SETTLEMENTS_SOURCE_NAME, run: () => runSettlementsIngestion() },
};

// "Refresh all" mirrors `npm run refresh:data`'s scope on purpose — it is
// NOT every pipeline this app knows about. PTA enrichment (hours-long,
// strict USPTO rate limit) and litigation (CourtListener's 5 req/min,
// 125/day budget) are both deliberately excluded from that script for the
// same reason (see refresh-data.ts and litigation/index.ts's own top
// comments), and used to be silently included here anyway — so one
// "Refresh all" click could leave the button reading "Running…" for hours
// with nothing on the page explaining why. Both keep their own dedicated
// trigger instead; PIPELINE_ORDER here is only "all", not "every".
export const PIPELINE_ORDER: PipelineKey[] = ["orange_book", "purple_book", "paragraph_iv"];

// In-memory only — resets on server restart, which is fine: this is the
// fast/atomic guard against a same-process double-click race (synchronous
// check-then-add, no `await` between them, so two near-simultaneous
// requests can't both pass). The DB check below is what survives a
// restart and catches a crashed process's orphaned RUNNING row.
const runningInMemory = new Set<PipelineKey>();

// PTA alone can legitimately run for hours (see README) — this threshold
// is picked so no real run ever gets near it; it only ever fires for a
// genuinely orphaned row from a crashed process. Checked lazily, at the
// moment someone next tries to trigger that pipeline — no reaper cron.
const STALE_RUNNING_THRESHOLD_MS = 6 * 60 * 60 * 1000;

// Returns the currently-RUNNING IngestionRun's id for this pipeline, or
// null if it isn't running (also used by stopPipeline, which needs the
// actual row id to set cancelRequested on).
async function findRunningRunId(key: PipelineKey): Promise<string | null> {
  const source = await prisma.dataSource.findUnique({ where: { name: PIPELINES[key].sourceName } });
  if (!source) return null;

  const latest = await prisma.ingestionRun.findFirst({ where: { sourceId: source.id }, orderBy: { startedAt: "desc" } });
  if (!latest || latest.status !== "RUNNING") return null;

  if (Date.now() - latest.startedAt.getTime() > STALE_RUNNING_THRESHOLD_MS) {
    await prisma.ingestionRun.update({
      where: { id: latest.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        summary: { errorMessage: "Marked stale: still RUNNING after 6h with no completion — likely an orphaned run from a crashed process." },
      },
    });
    return null;
  }

  return latest.id;
}

async function isRunning(key: PipelineKey): Promise<boolean> {
  if (runningInMemory.has(key)) return true;
  return (await findRunningRunId(key)) != null;
}

export type TriggerResult = { ok: true } | { ok: false; reason: "already_running"; busy: PipelineKey[] };

export async function triggerPipeline(key: PipelineKey): Promise<TriggerResult> {
  if (await isRunning(key)) return { ok: false, reason: "already_running", busy: [key] };

  runningInMemory.add(key);
  // Deliberately not awaited — this is the actual "return before it's
  // done" boundary the route relies on. Each runXIngestion() already
  // catches its own errors into a FAILED IngestionRun row; this .catch is
  // only a last-resort net for something escaping that contract entirely.
  PIPELINES[key]
    .run()
    .catch((error) => console.error(`[orchestrator] ${key} threw unexpectedly:`, error))
    .finally(() => runningInMemory.delete(key));

  return { ok: true };
}

export type StopResult = { ok: true } | { ok: false; reason: "not_running" | "not_cancellable" };

export async function stopPipeline(key: PipelineKey): Promise<StopResult> {
  if (!CANCELLABLE_PIPELINES.has(key)) return { ok: false, reason: "not_cancellable" };
  const runId = await findRunningRunId(key);
  if (!runId) return { ok: false, reason: "not_running" };
  await requestCancel(runId);
  return { ok: true };
}

export async function triggerAll(): Promise<TriggerResult> {
  const busy = (await Promise.all(PIPELINE_ORDER.map(async (k) => ((await isRunning(k)) ? k : null)))).filter(
    (k): k is PipelineKey => k != null,
  );
  if (busy.length > 0) return { ok: false, reason: "already_running", busy };

  // Reserve all of them atomically (synchronously, before any await inside
  // the chain below) so an individual trigger can't sneak into pipeline
  // #2's slot while #1 is still running as part of this chain.
  for (const k of PIPELINE_ORDER) runningInMemory.add(k);

  (async () => {
    for (const k of PIPELINE_ORDER) {
      try {
        const summary = await PIPELINES[k].run();
        runningInMemory.delete(k);
        // mirrors scripts/refresh-data.ts's own stop-on-failure behavior;
        // CANCELLED also stops the chain — a Stop click on step 2 of 3
        // shouldn't be overridden by "all" auto-starting step 3 right after.
        if (summary.status === "FAILED" || summary.status === "CANCELLED") break;
      } catch (error) {
        console.error(`[orchestrator] ${k} threw unexpectedly during "all":`, error);
        runningInMemory.delete(k);
        break;
      }
    }
    // Safety net if the loop exited early (break) — release any pipelines
    // reserved above that never got their own turn to run.
    for (const k of PIPELINE_ORDER) runningInMemory.delete(k);
  })();

  return { ok: true };
}
