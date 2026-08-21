"use server";

import { requireAnalyst } from "@/lib/session";
import * as manualEntry from "@/lib/ingestion/manualEntry";
import {
  ManualPatentSchema,
  ManualExclusivitySchema,
  ManualGenericChallengeSchema,
  ManualLitigationCaseSchema,
  PatentNumberLookupSchema,
  DocketNumberLookupSchema,
  LinkUnlinkedEntrySchema,
} from "@/lib/ingestion/manualEntry/schemas";
import type { ActionResult } from "@/lib/ingestion/manualEntry/types";

// Every action re-verifies the caller is an analyst, even though the /data
// page that renders these forms is already gated by requireAnalyst() — a
// Server Action is a public endpoint in its own right (reachable directly,
// not just via this page's UI), so it must not trust that the UI it was
// rendered from already checked. Same reasoning as src/app/team/actions.ts.

// ---- Lookups (no DB write — preview only) --------------------------------

export async function previewPatentLookupAction(patentNumber: string) {
  await requireAnalyst();
  const parsed = PatentNumberLookupSchema.safeParse({ patentNumber });
  if (!parsed.success) return { status: "error" as const, errorMessage: parsed.error.issues[0]?.message ?? "Invalid patent number." };
  return manualEntry.lookupPatentPreview(parsed.data.patentNumber);
}

export async function previewGenericChallengeMatchAction(rldNdaNumber: string | null, dosageForm: string) {
  await requireAnalyst();
  return manualEntry.previewGenericChallengeMatch(rldNdaNumber, dosageForm);
}

export async function previewDocketLookupAction(docketNumber: string) {
  await requireAnalyst();
  const parsed = DocketNumberLookupSchema.safeParse({ docketNumber });
  if (!parsed.success) return { status: "error" as const, errorMessage: parsed.error.issues[0]?.message ?? "Invalid docket number." };
  return manualEntry.lookupDocketPreview(parsed.data.docketNumber);
}

// ---- Submissions (real DB writes) -----------------------------------------

export async function submitManualPatentAction(input: unknown): Promise<ActionResult<{ patentId: string }>> {
  const user = await requireAnalyst();
  const parsed = ManualPatentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  return manualEntry.createManualPatent(parsed.data, user.id);
}

export async function submitManualExclusivityAction(input: unknown): Promise<ActionResult<{ exclusivityId: string }>> {
  const user = await requireAnalyst();
  const parsed = ManualExclusivitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  return manualEntry.createManualExclusivity(parsed.data, user.id);
}

export async function submitManualGenericChallengeAction(input: unknown): Promise<ActionResult<{ challengeId: string }>> {
  const user = await requireAnalyst();
  const parsed = ManualGenericChallengeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  return manualEntry.createManualGenericChallenge(parsed.data, user.id);
}

export async function submitManualLitigationCaseAction(input: unknown): Promise<ActionResult<{ caseId: string }>> {
  const user = await requireAnalyst();
  const parsed = ManualLitigationCaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  return manualEntry.createManualLitigationCase(parsed.data, user.id);
}

export async function linkUnlinkedEntryAction(input: unknown): Promise<ActionResult> {
  const user = await requireAnalyst();
  const parsed = LinkUnlinkedEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  return manualEntry.linkManualEntryToProduct(parsed.data.entityType, parsed.data.entityId, parsed.data.drugId, user.id);
}
