import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { unauthorizedResponse, forbiddenResponse, validationErrorResponse, notFoundResponse, conflictResponse } from "@/lib/api/errors";
import { stopPipeline, type PipelineKey } from "@/lib/ingestion/orchestrator";

// Every real pipeline checks for a stop request mid-run now (see
// orchestrator.ts's CANCELLABLE_PIPELINES and each pipeline's own run
// loop) — "all" isn't a real pipeline and isn't in this enum, so stopping
// a "Refresh all" batch means stopping whichever of its steps is currently
// running, not the batch as a concept.
const StopBodySchema = z.object({
  pipeline: z.enum(["orange_book", "purple_book", "paragraph_iv", "pta", "litigation", "litigation_complaints", "settlements"]),
});

// Same auth shape as ../route.ts: analyst-only, enforced here rather than
// relying on the /data UI hiding the button, since this route is directly
// fetchable by anyone with a valid session cookie.
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return unauthorizedResponse();
  if (user.tier !== "analyst") return forbiddenResponse("Analyst access is required to stop data ingestion.");

  const body = await request.json().catch(() => null);
  const parsed = StopBodySchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const result = await stopPipeline(parsed.data.pipeline as PipelineKey);

  if (!result.ok) {
    if (result.reason === "not_running") return notFoundResponse("This pipeline isn't currently running.");
    return conflictResponse("This pipeline doesn't support stopping mid-run.");
  }

  // 202, not 200: the pipeline's own loop checks the cancellation flag
  // between candidates, so the run stops within one candidate's worth of
  // latency (seconds), not instantly — mirrors the "started" 202 the
  // trigger route returns for the same reason (accepted, not yet done).
  return NextResponse.json({ data: { pipeline: parsed.data.pipeline, status: "stopping" } }, { status: 202 });
}
