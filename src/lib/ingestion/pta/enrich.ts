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

export type EnrichOutcome =
  | { kind: "updated"; ptaDays: number; filingDate: Date; before: { nominal: Date; effective: Date; adjustment: number | null }; after: { effective: Date; adjustment: number } }
  | { kind: "no_data"; reason: string }
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
