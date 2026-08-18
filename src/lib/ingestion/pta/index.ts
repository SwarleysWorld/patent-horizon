import { prisma } from "@/lib/prisma";
import { UsptoOdpClient } from "./client";
import { ensurePtaDataSource, selectCandidatePatents, enrichOnePatent, type EnrichOutcome } from "./enrich";

export { PTA_SOURCE_NAME } from "./enrich";

export interface PtaRunOptions {
  limit?: number;
  patentIds?: string[];
  apiKey?: string; // override for testing; defaults to process.env.USPTO_ODP_API_KEY
}

export interface PtaRunResultRow {
  patentId: string;
  patentNumber: string;
  drugId: string | null;
  biologicProductId: string | null;
  outcome: EnrichOutcome;
}

export interface PtaRunSummary {
  runId: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  candidateCount: number;
  updated: number;
  noData: number;
  errors: number;
  results: PtaRunResultRow[];
  errorMessage?: string;
}

export async function runPtaEnrichment(opts: PtaRunOptions = {}): Promise<PtaRunSummary> {
  const apiKey = opts.apiKey ?? process.env.USPTO_ODP_API_KEY;
  const source = await ensurePtaDataSource();
  const run = await prisma.ingestionRun.create({ data: { sourceId: source.id, status: "RUNNING" } });
  const startedAt = run.startedAt;

  if (!apiKey) {
    const finishedAt = new Date();
    const errorMessage =
      "USPTO_ODP_API_KEY is not set. See README.md \"Patent Term Adjustment enrichment\" for how to obtain one.";
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt, summary: { errorMessage } },
    });
    return {
      runId: run.id,
      status: "FAILED",
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      candidateCount: 0,
      updated: 0,
      noData: 0,
      errors: 0,
      results: [],
      errorMessage,
    };
  }

  const client = new UsptoOdpClient(apiKey);
  const candidates = await selectCandidatePatents(source.id, { limit: opts.limit, patentIds: opts.patentIds });

  const results: PtaRunResultRow[] = [];
  let updated = 0;
  let noData = 0;
  let errors = 0;
  let abortedOnAuthError = false;
  const verifiedAt = new Date();

  // Strictly sequential — ODP's rate limit policy is burst=1 (no
  // concurrent requests per API key at all).
  for (const patent of candidates) {
    const outcome = await enrichOnePatent(client, source.id, patent, verifiedAt);
    results.push({
      patentId: patent.id,
      patentNumber: patent.patentNumber,
      drugId: patent.drugId,
      biologicProductId: patent.biologicProductId,
      outcome,
    });

    if (outcome.kind === "updated") updated++;
    else if (outcome.kind === "no_data") noData++;
    else {
      errors++;
      if (outcome.authError) {
        // A bad/missing key won't fix itself on the next patent — stop
        // burning through the candidate list and surface it clearly.
        abortedOnAuthError = true;
        break;
      }
    }
  }

  const finishedAt = new Date();
  const status: PtaRunSummary["status"] =
    errors === 0 ? "SUCCESS" : updated + noData > 0 ? "PARTIAL" : "FAILED";

  await prisma.ingestionRun.update({
    where: { id: run.id },
    data: {
      status,
      finishedAt,
      patentsUpserted: updated,
      rowsSkipped: noData + errors,
      summary: JSON.parse(
        JSON.stringify({ candidateCount: candidates.length, updated, noData, errors, abortedOnAuthError }),
      ),
    },
  });

  return {
    runId: run.id,
    status,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    candidateCount: candidates.length,
    updated,
    noData,
    errors,
    results,
    errorMessage: abortedOnAuthError ? "aborted after an auth (403) error — check USPTO_ODP_API_KEY" : undefined,
  };
}
