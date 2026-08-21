import { prisma } from "@/lib/prisma";
import type { UsptoOdpClient } from "./client";
import {
  daysBetween,
  isStandardUtilityPatentNumber,
  computeStandardEffectiveExpiry,
  computeNonStandardEffectiveExpiry,
  STATUTORY_TERM_YEARS,
} from "./computeExpiry";

export const PTA_SOURCE_NAME = "USPTO Patent Term Adjustment (ODP)";
const PTA_SOURCE_URL = "https://data.uspto.gov/apis/patent-file-wrapper/patent-term-adjustment";

// drugId/biologicProductId are both nullable and mutually exclusive
// (enforced by Patent_single_parent_check) — this function enriches by
// patent number alone and doesn't care which parent a candidate has, so a
// Purple Book patent is just as valid a candidate as an Orange Book one
// with zero special-casing below.
export interface PatentCandidate {
  id: string;
  patentNumber: string;
  drugId: string | null;
  biologicProductId: string | null;
  nominalExpiryDate: Date;
  effectiveExpiryDate: Date;
  expiryAdjustmentDays: number | null;
}

const CANDIDATE_SELECT = {
  id: true,
  patentNumber: true,
  drugId: true,
  biologicProductId: true,
  nominalExpiryDate: true,
  effectiveExpiryDate: true,
  expiryAdjustmentDays: true,
} as const;

export async function selectCandidatePatents(
  sourceId: string,
  opts: { limit?: number; patentIds?: string[] },
): Promise<PatentCandidate[]> {
  if (opts.patentIds && opts.patentIds.length > 0) {
    return prisma.patent.findMany({
      where: { id: { in: opts.patentIds } },
      select: CANDIDATE_SELECT,
    });
  }
  return prisma.patent.findMany({
    where: { ingestionRecords: { none: { sourceId } } },
    select: CANDIDATE_SELECT,
    // Patents closest to expiry are the most valuable to correct first —
    // they're the ones a generic manufacturer is watching right now.
    orderBy: { effectiveExpiryDate: "asc" },
    take: opts.limit,
  });
}

// A computed effective date this far past the existing (Orange/Purple
// Book-listed) nominal is treated as suspect rather than applied — see the
// "flagged" branch in enrichOnePatent below. Chosen well above any
// plausible real PTA grant (the statute's own delay categories rarely
// stack past a few years even in extreme cases) but comfortably below a
// confirmed real-world instance of this exact failure mode: a continuation
// application (USPTO patent 12678442, the JENTADUETO family) whose own
// filing date is ~15 years (5,524 days) later than its earliest
// priority-claimed filing date, producing a wildly overstated "fresh
// filing date + 20y" baseline. That's the known cause — this patent's
// child application inherits the original's term rather than getting a
// fresh 20 years from its own later filing date — and it isn't modeled
// here (see README); this threshold only stops the bad number from being
// silently written, it doesn't compute the correct one.
const SUSPICIOUS_ADJUSTMENT_THRESHOLD_DAYS = 3650;

export type EnrichOutcome =
  | { kind: "updated"; ptaDays: number; filingDate: Date; before: { nominal: Date; effective: Date; adjustment: number | null }; after: { effective: Date; adjustment: number } }
  | { kind: "no_data"; reason: string }
  | { kind: "flagged"; reason: string; filingDate: Date; ptaDays: number; existingNominal: Date; computedEffective: Date; gapDays: number }
  | { kind: "error"; message: string; authError?: boolean };

export async function enrichOnePatent(
  client: UsptoOdpClient,
  sourceId: string,
  patent: PatentCandidate,
  verifiedAt: Date,
): Promise<EnrichOutcome> {
  const result = await client.lookupByPatentNumber(patent.patentNumber);

  if (result.status === "error") {
    return { kind: "error", message: result.errorMessage ?? "unknown error", authError: result.authError };
  }

  if (result.status === "not_found" || !result.filingDate) {
    await prisma.ingestionRecord.create({
      data: {
        sourceId,
        patentId: patent.id,
        verifiedAt,
        changeNote: result.status === "not_found"
          ? "no USPTO PTA record found (pre-2001 filing, or not in the ODP dataset)"
          : `USPTO record found but no filing date returned`,
        rawPayload: result.raw ? JSON.parse(JSON.stringify(result.raw)) : undefined,
      },
    });
    return { kind: "no_data", reason: result.status === "not_found" ? "not found in USPTO ODP" : "found, but no filing date" };
  }

  const filingDate = new Date(result.filingDate);
  if (Number.isNaN(filingDate.getTime())) {
    await prisma.ingestionRecord.create({
      data: {
        sourceId,
        patentId: patent.id,
        verifiedAt,
        changeNote: `USPTO filingDate unparseable: "${result.filingDate}"`,
        rawPayload: result.raw ? JSON.parse(JSON.stringify(result.raw)) : undefined,
      },
    });
    return { kind: "no_data", reason: "unparseable filing date" };
  }

  const ptaDays = result.adjustmentTotalQuantity ?? 0;
  const standard = isStandardUtilityPatentNumber(patent.patentNumber);

  let effectiveExpiryDate: Date;
  let basis: string;
  if (standard) {
    effectiveExpiryDate = computeStandardEffectiveExpiry(filingDate, ptaDays);
    basis = `filingDate(${result.filingDate}) + ${STATUTORY_TERM_YEARS}y + ${ptaDays}d PTA`;
  } else {
    // Reissue/non-standard: delta on top of the existing (Orange
    // Book-derived) nominal, since we can't recompute a statutory baseline.
    effectiveExpiryDate = computeNonStandardEffectiveExpiry(patent.nominalExpiryDate, ptaDays);
    basis = `non-standard patent number — applied ${ptaDays}d PTA as delta to existing nominalExpiryDate rather than recomputing from filing date`;
  }

  const expiryAdjustmentDays = daysBetween(patent.nominalExpiryDate, effectiveExpiryDate);

  if (expiryAdjustmentDays > SUSPICIOUS_ADJUSTMENT_THRESHOLD_DAYS) {
    // Still write a record — checked, not skipped — so this patent doesn't
    // get re-selected as a candidate on every future run just to compute
    // the same suspect result again. The Patent row itself is left
    // untouched: whatever was there before (typically Orange/Purple
    // Book's own listed date) stays the visible figure until a human
    // resolves this.
    await prisma.ingestionRecord.create({
      data: {
        sourceId,
        patentId: patent.id,
        verifiedAt,
        changeNote: `USPTO PTA=${ptaDays}d, filingDate(${result.filingDate}) + ${STATUTORY_TERM_YEARS}y computes an effective date ${expiryAdjustmentDays}d (${(expiryAdjustmentDays / 365).toFixed(1)}y) past the existing listed date — beyond the ${SUSPICIOUS_ADJUSTMENT_THRESHOLD_DAYS}d sanity threshold, likely a continuation/divisional application whose own filing date isn't its term's true starting point (see README). Flagged for manual review; existing dates left unchanged.`,
        rawPayload: JSON.parse(JSON.stringify(result.raw)),
      },
    });
    return {
      kind: "flagged",
      reason: `computed effective date is ${expiryAdjustmentDays}d past the existing listed date — beyond the ${SUSPICIOUS_ADJUSTMENT_THRESHOLD_DAYS}d sanity threshold`,
      filingDate,
      ptaDays,
      existingNominal: patent.nominalExpiryDate,
      computedEffective: effectiveExpiryDate,
      gapDays: expiryAdjustmentDays,
    };
  }

  await prisma.$transaction([
    prisma.patent.update({
      where: { id: patent.id },
      data: {
        filingDate,
        effectiveExpiryDate,
        expiryAdjustmentDays,
      },
    }),
    prisma.ingestionRecord.create({
      data: {
        sourceId,
        patentId: patent.id,
        verifiedAt,
        changeNote: `USPTO PTA=${ptaDays}d. Basis: ${basis}. Gap vs. Orange Book listed date: ${expiryAdjustmentDays}d.`,
        rawPayload: JSON.parse(JSON.stringify(result.raw)),
      },
    }),
  ]);

  return {
    kind: "updated",
    ptaDays,
    filingDate,
    before: {
      nominal: patent.nominalExpiryDate,
      effective: patent.effectiveExpiryDate,
      adjustment: patent.expiryAdjustmentDays,
    },
    after: { effective: effectiveExpiryDate, adjustment: expiryAdjustmentDays },
  };
}

export async function ensurePtaDataSource() {
  return prisma.dataSource.upsert({
    where: { name: PTA_SOURCE_NAME },
    update: { url: PTA_SOURCE_URL },
    create: { name: PTA_SOURCE_NAME, url: PTA_SOURCE_URL },
  });
}
