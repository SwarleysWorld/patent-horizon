import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { unauthorizedResponse, forbiddenResponse, validationErrorResponse, conflictResponse } from "@/lib/api/errors";
import { triggerPipeline, triggerAll, type PipelineKey } from "@/lib/ingestion/orchestrator";

const TriggerBodySchema = z.object({
  pipeline: z.enum(["orange_book", "purple_book", "paragraph_iv", "pta", "all"]),
});

// Analyst-only, enforced here (not just hidden in the /data UI) — a route
// handler is directly fetchable by anyone with a valid session cookie,
// same reasoning already applied to Server Actions in
// src/app/team/actions.ts. requireAnalyst() (used by the /data PAGE
// itself) only works in a Server Component/Server Action context — it
// calls next/headers()/redirect(), both wrong for a JSON API — so this
// route composes getSessionUser() + an explicit tier check instead, the
// same way every other route here checks getSessionUser().
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return unauthorizedResponse();
  if (user.tier !== "analyst") return forbiddenResponse("Analyst access is required to trigger data ingestion.");

  const body = await request.json().catch(() => null);
  const parsed = TriggerBodySchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const result =
    parsed.data.pipeline === "all" ? await triggerAll() : await triggerPipeline(parsed.data.pipeline as PipelineKey);

  if (!result.ok) {
    return conflictResponse(
      `Already running: ${result.busy.join(", ")}. Wait for it to finish before starting another run.`,
    );
  }

  return NextResponse.json({ data: { pipeline: parsed.data.pipeline, status: "started" } }, { status: 202 });
}
