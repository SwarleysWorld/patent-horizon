// Manual data entry — an Analyst filling a specific gap the automated
// pipelines missed, one record at a time. No auth checks in this module
// (same separation as pta/enrich.ts's runPtaEnrichment): the caller
// (src/app/data/actions.ts's Server Actions) is responsible for
// requireAnalyst(), which also makes every function here directly
// unit-testable with no Next.js request-context concerns.

import { prisma } from "@/lib/prisma";
import { UsptoOdpClient } from "../pta/client";
import { computeStandardEffectiveExpiry, isStandardUtilityPatentNumber, STATUTORY_TERM_YEARS } from "../pta/computeExpiry";
import { CourtListenerClient } from "../litigation/client";
import {
  splitCaseName,
  matchCompanyByName,
  normalizeCompanyName,
  resolveCandidateDrugs,
  toLitigationCourt,
  type CompanyRef,
  type CompanyMatch,
} from "../litigation/match";
import type { LitigationCourtCode } from "../litigation/types";
import { matchDrugs, type DrugMatch } from "../paragraphIV/load";
import { scoreManualLitigationMatch } from "./match";
import type {
  ActionResult,
  ManualExclusivityInput,
  ManualGenericChallengeInput,
  ManualLitigationCaseInput,
  ManualMatchConfidence,
  ManualPatentInput,
} from "./types";

export const MANUAL_ENTRY_SOURCE_NAME = "Manual Entry";

export async function ensureManualEntryDataSource() {
  return prisma.dataSource.upsert({
    where: { name: MANUAL_ENTRY_SOURCE_NAME },
    update: {},
    create: { name: MANUAL_ENTRY_SOURCE_NAME },
  });
}

// ---- Patent: USPTO auto-fetch preview (no DB write) ---------------------

export interface PatentLookupPreview {
  status: "found" | "not_found" | "error";
  filingDate: string | null;
  nominalExpiryDate: string | null; // only computable for a standard utility patent number — see isStandardPatentNumber
  effectiveExpiryDate: string | null;
  expiryAdjustmentDays: number | null;
  isStandardPatentNumber: boolean;
  errorMessage?: string;
}

export async function lookupPatentPreview(patentNumber: string, apiKey?: string): Promise<PatentLookupPreview> {
  const standard = isStandardUtilityPatentNumber(patentNumber);
  const key = apiKey ?? process.env.USPTO_ODP_API_KEY;
  if (!key) {
    return {
      status: "error",
      filingDate: null,
      nominalExpiryDate: null,
      effectiveExpiryDate: null,
      expiryAdjustmentDays: null,
      isStandardPatentNumber: standard,
      errorMessage: "USPTO_ODP_API_KEY is not set.",
    };
  }

  const client = new UsptoOdpClient(key);
  const result = await client.lookupByPatentNumber(patentNumber);

  if (result.status === "error") {
    return {
      status: "error",
      filingDate: null,
      nominalExpiryDate: null,
      effectiveExpiryDate: null,
      expiryAdjustmentDays: null,
      isStandardPatentNumber: standard,
      errorMessage: result.errorMessage,
    };
  }
  if (result.status === "not_found" || !result.filingDate) {
    return { status: "not_found", filingDate: null, nominalExpiryDate: null, effectiveExpiryDate: null, expiryAdjustmentDays: null, isStandardPatentNumber: standard };
  }

  const ptaDays = result.adjustmentTotalQuantity ?? 0;
  if (!standard) {
    // Reissue/non-standard: no statutory baseline to compute from filing
    // date alone (same documented limitation as the automated PTA
    // pipeline) — the Analyst types nominalExpiryDate by hand; PTA days
    // are still surfaced so they can apply the delta themselves.
    return { status: "found", filingDate: result.filingDate, nominalExpiryDate: null, effectiveExpiryDate: null, expiryAdjustmentDays: ptaDays, isStandardPatentNumber: false };
  }

  const filingDate = new Date(result.filingDate);
  const nominalExpiryDate = new Date(
    Date.UTC(filingDate.getUTCFullYear() + STATUTORY_TERM_YEARS, filingDate.getUTCMonth(), filingDate.getUTCDate()),
  );
  const effectiveExpiryDate = computeStandardEffectiveExpiry(filingDate, ptaDays);

  return {
    status: "found",
    filingDate: result.filingDate,
    nominalExpiryDate: nominalExpiryDate.toISOString().slice(0, 10),
    effectiveExpiryDate: effectiveExpiryDate.toISOString().slice(0, 10),
    expiryAdjustmentDays: ptaDays,
    isStandardPatentNumber: true,
  };
}

// ---- Generic Challenge: NDA-number matching preview (no DB write) ------

export interface GenericChallengeMatchPreview {
  match: DrugMatch;
  candidateDrugs: { id: string; brandName: string; dosageForm: string }[];
}

export async function previewGenericChallengeMatch(rldNdaNumber: string | null, dosageForm: string): Promise<GenericChallengeMatchPreview> {
  const match = await matchDrugs({ rldNdaNumber, dosageForm });
  const candidateDrugs =
    match.drugIds.length > 0
      ? await prisma.drug.findMany({ where: { id: { in: match.drugIds } }, select: { id: true, brandName: true, dosageForm: true } })
      : [];
  return { match, candidateDrugs };
}

// ---- Litigation: docket-number lookup preview (no DB write) -------------

export interface DocketLookupPreview {
  status: "found" | "not_found" | "error";
  errorMessage?: string;
  hit?: {
    externalDocketId: number;
    docketNumber: string;
    court: LitigationCourtCode;
    filingDate: string | null;
    dateTerminated: string | null;
    judge: string | null;
    natureOfSuit: string | null;
    cause: string | null;
  };
  plaintiffNameRaw?: string;
  defendantNameRaw?: string;
  plaintiffMatch?: CompanyMatch;
  defendantMatch?: CompanyMatch;
  candidateDrugs?: { id: string; brandName: string }[];
  score?: { tier: ManualMatchConfidence; note: string };
}

export async function lookupDocketPreview(docketNumber: string, apiKey?: string): Promise<DocketLookupPreview> {
  const key = apiKey ?? process.env.COURTLISTENER_API_KEY;
  if (!key) return { status: "error", errorMessage: "COURTLISTENER_API_KEY is not set." };

  const client = new CourtListenerClient(key);
  const result = await client.lookupByDocketNumber(docketNumber);
  if (result.status === "error") return { status: "error", errorMessage: result.errorMessage };
  if (result.hits.length === 0) return { status: "not_found" };

  // Court-scoped lookup by exact docket number — verified live this
  // returns at most one real match (see litigation/client.ts's doc
  // comment on lookupByDocketNumber).
  const hit = result.hits[0];
  const court = toLitigationCourt(hit.courtId);
  if (!court) return { status: "error", errorMessage: `Unexpected court "${hit.courtId}" outside the DE/NJ scope this app tracks.` };

  const split = splitCaseName(hit.caseName);
  if (!split) return { status: "error", errorMessage: `Case caption "${hit.caseName}" didn't split into two parties ("X v. Y").` };

  const allCompanies = await prisma.company.findMany({ select: { id: true, name: true } });
  const companiesByNormalizedName = new Map<string, CompanyRef[]>();
  for (const c of allCompanies) {
    const normKey = normalizeCompanyName(c.name);
    const bucket = companiesByNormalizedName.get(normKey) ?? [];
    bucket.push(c);
    companiesByNormalizedName.set(normKey, bucket);
  }

  const plaintiffMatch = matchCompanyByName(split.plaintiffRaw, companiesByNormalizedName);
  const defendantMatch = matchCompanyByName(split.defendantRaw, companiesByNormalizedName);

  // Union of both matched companies' candidate products — there's no
  // "searched company" here to prioritize one side over the other, unlike
  // the automated pipeline.
  const candidateIds = new Set<string>();
  if (plaintiffMatch.company) for (const id of await resolveCandidateDrugs(plaintiffMatch.company.id)) candidateIds.add(id);
  if (defendantMatch.company) for (const id of await resolveCandidateDrugs(defendantMatch.company.id)) candidateIds.add(id);
  const candidateDrugIds = [...candidateIds];

  const score = scoreManualLitigationMatch({
    plaintiffMatch,
    defendantMatch,
    candidateDrugIds,
    natureOfSuit: hit.natureOfSuit,
    cause: hit.cause,
  });

  const candidateDrugs =
    candidateDrugIds.length > 0
      ? await prisma.drug.findMany({ where: { id: { in: candidateDrugIds } }, select: { id: true, brandName: true } })
      : [];

  return {
    status: "found",
    hit: {
      externalDocketId: hit.externalDocketId,
      docketNumber: hit.docketNumber,
      court,
      filingDate: hit.dateFiled,
      dateTerminated: hit.dateTerminated,
      judge: hit.assignedTo,
      natureOfSuit: hit.natureOfSuit,
      cause: hit.cause,
    },
    plaintiffNameRaw: split.plaintiffRaw,
    defendantNameRaw: split.defendantRaw,
    plaintiffMatch,
    defendantMatch,
    candidateDrugs,
    score,
  };
}

// ---- Create operations (real DB writes) ----------------------------------

function productParentField(productId: string, productSource: "orange_book" | "purple_book") {
  return productSource === "orange_book" ? { drugId: productId } : { biologicProductId: productId };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Unique constraint");
}

export async function createManualPatent(input: ManualPatentInput, enteredByUserId: string): Promise<ActionResult<{ patentId: string }>> {
  const source = await ensureManualEntryDataSource();
  const verifiedAt = new Date();

  try {
    const patent = await prisma.$transaction(async (tx) => {
      const created = await tx.patent.create({
        data: {
          ...productParentField(input.productId, input.productSource),
          patentNumber: input.patentNumber,
          coversDrugSubstance: input.coversDrugSubstance,
          coversDrugProduct: input.coversDrugProduct,
          useCode: input.useCode,
          filingDate: input.filingDate ? new Date(input.filingDate) : null,
          nominalExpiryDate: new Date(input.nominalExpiryDate),
          effectiveExpiryDate: new Date(input.effectiveExpiryDate),
          expiryAdjustmentDays: input.expiryAdjustmentDays,
          submittedDate: input.submittedDate ? new Date(input.submittedDate) : null,
        },
      });
      await tx.ingestionRecord.create({
        data: { sourceId: source.id, patentId: created.id, verifiedAt, enteredByUserId, changeNote: "Manually entered by analyst." },
      });
      return created;
    });
    return { ok: true, data: { patentId: patent.id } };
  } catch (error) {
    return { ok: false, message: isUniqueConstraintError(error) ? "A patent with this number/use-code already exists for this product." : "Failed to save." };
  }
}

export async function createManualExclusivity(input: ManualExclusivityInput, enteredByUserId: string): Promise<ActionResult<{ exclusivityId: string }>> {
  const source = await ensureManualEntryDataSource();
  const verifiedAt = new Date();

  try {
    const exclusivity = await prisma.$transaction(async (tx) => {
      const created = await tx.exclusivity.create({
        data: {
          ...productParentField(input.productId, input.productSource),
          code: input.code,
          description: input.description,
          grantedDate: input.grantedDate ? new Date(input.grantedDate) : null,
          expirationDate: new Date(input.expirationDate),
        },
      });
      await tx.ingestionRecord.create({
        data: { sourceId: source.id, exclusivityId: created.id, verifiedAt, enteredByUserId, changeNote: "Manually entered by analyst." },
      });
      return created;
    });
    return { ok: true, data: { exclusivityId: exclusivity.id } };
  } catch (error) {
    return { ok: false, message: isUniqueConstraintError(error) ? "An exclusivity with this code/expiration already exists for this product." : "Failed to save." };
  }
}

export async function createManualGenericChallenge(
  input: ManualGenericChallengeInput,
  enteredByUserId: string,
): Promise<ActionResult<{ challengeId: string }>> {
  const source = await ensureManualEntryDataSource();
  const verifiedAt = new Date();
  const naturalKeyNda = input.rldNdaNumber ?? `NO_NDA:${input.rldName}`;

  try {
    const challenge = await prisma.$transaction(async (tx) => {
      const created = await tx.genericChallenge.create({
        data: {
          naturalKeyNda,
          activeIngredient: input.activeIngredient,
          dosageForm: input.dosageForm,
          strength: input.strength,
          rldName: input.rldName,
          rldNdaNumber: input.rldNdaNumber,
          submissionDateType: input.submissionDateType,
          submissionDate: input.submissionDate ? new Date(input.submissionDate) : null,
          decisionHistory: [],
          rawStrengthText: input.strength,
        },
      });
      if (input.confirmedDrugId) {
        await tx.genericChallengeDrug.create({ data: { genericChallengeId: created.id, drugId: input.confirmedDrugId } });
      }
      await tx.ingestionRecord.create({
        data: {
          sourceId: source.id,
          genericChallengeId: created.id,
          verifiedAt,
          enteredByUserId,
          changeNote: input.confirmedDrugId
            ? "Manually entered by analyst; matched and linked to a product."
            : `Manually entered by analyst; ${input.rldNdaNumber ? "no confirmed product match" : "no NDA number given"} — saved unlinked.`,
        },
      });
      return created;
    });
    return { ok: true, data: { challengeId: challenge.id } };
  } catch (error) {
    return {
      ok: false,
      message: isUniqueConstraintError(error)
        ? "A generic challenge with this NDA/ingredient/dosage-form/strength combination already exists."
        : "Failed to save.",
    };
  }
}

export async function createManualLitigationCase(
  input: ManualLitigationCaseInput,
  enteredByUserId: string,
): Promise<ActionResult<{ caseId: string }>> {
  const source = await ensureManualEntryDataSource();
  const verifiedAt = new Date();

  try {
    const litCase = await prisma.$transaction(async (tx) => {
      const created = await tx.litigationCase.create({
        data: {
          plaintiffCompanyId: input.plaintiffCompanyId,
          plaintiffNameRaw: input.plaintiffNameRaw,
          defendantCompanyId: input.defendantCompanyId,
          defendantNameRaw: input.defendantNameRaw,
          // Schema enum has no NONE tier — see types.ts's ManualMatchConfidence
          // doc comment. Stored as LOW; the real "unlinked" signal is zero
          // drugLinks, not this field.
          matchConfidence: input.matchConfidence === "NONE" ? "LOW" : input.matchConfidence,
          matchNote: input.matchNote,
          earliestFilingDate: input.docket.filingDate ? new Date(input.docket.filingDate) : null,
          outcome: input.docket.dateTerminated ? "UNCLEAR" : "ONGOING",
          outcomeNote: input.docket.dateTerminated
            ? "All linked dockets show a termination date, but docket-level metadata alone doesn't indicate how the case concluded."
            : "At least one linked docket has no termination date on record.",
          dockets: {
            create: [
              {
                externalDocketId: input.docket.externalDocketId,
                docketNumber: input.docket.docketNumber,
                court: input.docket.court,
                courtRaw: input.docket.court === "DE" ? "deld" : "njd",
                filingDate: input.docket.filingDate ? new Date(input.docket.filingDate) : null,
                dateTerminated: input.docket.dateTerminated ? new Date(input.docket.dateTerminated) : null,
                judge: input.docket.judge,
                natureOfSuit: input.docket.natureOfSuit,
              },
            ],
          },
        },
      });
      if (input.confirmedDrugId) {
        await tx.litigationCaseDrug.create({ data: { litigationCaseId: created.id, drugId: input.confirmedDrugId } });
      }
      await tx.ingestionRecord.create({
        data: {
          sourceId: source.id,
          litigationCaseId: created.id,
          verifiedAt,
          enteredByUserId,
          externalRef: input.docket.externalDocketId != null ? String(input.docket.externalDocketId) : null,
          changeNote: input.confirmedDrugId ? "Manually entered by analyst; matched and linked to a product." : "Manually entered by analyst; saved unlinked.",
        },
      });
      return created;
    });
    return { ok: true, data: { caseId: litCase.id } };
  } catch (error) {
    return { ok: false, message: isUniqueConstraintError(error) ? "A docket with this CourtListener id already exists." : "Failed to save." };
  }
}

// ---- Linking a previously-unlinked entry ---------------------------------

export async function linkManualEntryToProduct(
  entityType: "generic_challenge" | "litigation_case",
  entityId: string,
  drugId: string,
  enteredByUserId: string,
): Promise<ActionResult> {
  const source = await ensureManualEntryDataSource();
  const verifiedAt = new Date();

  const drug = await prisma.drug.findUnique({ where: { id: drugId }, select: { brandName: true } });
  if (!drug) return { ok: false, message: "Product not found." };

  try {
    if (entityType === "generic_challenge") {
      const challenge = await prisma.genericChallenge.findUnique({ where: { id: entityId }, select: { id: true } });
      if (!challenge) return { ok: false, message: "Generic challenge not found." };
      await prisma.$transaction([
        prisma.genericChallengeDrug.create({ data: { genericChallengeId: entityId, drugId } }),
        prisma.ingestionRecord.create({
          data: { sourceId: source.id, genericChallengeId: entityId, verifiedAt, enteredByUserId, changeNote: `Manually linked to ${drug.brandName} by analyst.` },
        }),
      ]);
    } else {
      const litCase = await prisma.litigationCase.findUnique({ where: { id: entityId }, select: { id: true } });
      if (!litCase) return { ok: false, message: "Litigation case not found." };
      await prisma.$transaction([
        prisma.litigationCaseDrug.create({ data: { litigationCaseId: entityId, drugId } }),
        prisma.ingestionRecord.create({
          data: { sourceId: source.id, litigationCaseId: entityId, verifiedAt, enteredByUserId, changeNote: `Manually linked to ${drug.brandName} by analyst.` },
        }),
      ]);
    }
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, message: isUniqueConstraintError(error) ? "Already linked to this product." : "Failed to link." };
  }
}

// ---- Read: unlinked entries + audit log ----------------------------------

export interface UnlinkedManualEntry {
  id: string;
  entityType: "generic_challenge" | "litigation_case";
  label: string;
  enteredAt: Date;
  enteredByUserId: string | null;
}

export async function getUnlinkedManualEntries(): Promise<UnlinkedManualEntry[]> {
  const source = await prisma.dataSource.findUnique({ where: { name: MANUAL_ENTRY_SOURCE_NAME } });
  if (!source) return [];

  const [challenges, cases] = await Promise.all([
    prisma.genericChallenge.findMany({
      where: { drugLinks: { none: {} }, ingestionRecords: { some: { sourceId: source.id } } },
      include: { ingestionRecords: { where: { sourceId: source.id }, orderBy: { verifiedAt: "desc" }, take: 1 } },
    }),
    prisma.litigationCase.findMany({
      where: { drugLinks: { none: {} }, ingestionRecords: { some: { sourceId: source.id } } },
      include: { ingestionRecords: { where: { sourceId: source.id }, orderBy: { verifiedAt: "desc" }, take: 1 } },
    }),
  ]);

  const entries: UnlinkedManualEntry[] = [
    ...challenges.map((c) => ({
      id: c.id,
      entityType: "generic_challenge" as const,
      label: `${c.rldName} — ${c.activeIngredient} ${c.strength}`,
      enteredAt: c.ingestionRecords[0]?.verifiedAt ?? c.createdAt,
      enteredByUserId: c.ingestionRecords[0]?.enteredByUserId ?? null,
    })),
    ...cases.map((c) => ({
      id: c.id,
      entityType: "litigation_case" as const,
      label: `${c.plaintiffNameRaw} v. ${c.defendantNameRaw}`,
      enteredAt: c.ingestionRecords[0]?.verifiedAt ?? c.createdAt,
      enteredByUserId: c.ingestionRecords[0]?.enteredByUserId ?? null,
    })),
  ];
  return entries.sort((a, b) => b.enteredAt.getTime() - a.enteredAt.getTime());
}

export interface ManualEntryAuditRow {
  id: string;
  entityType: "patent" | "exclusivity" | "generic_challenge" | "litigation_case";
  label: string;
  enteredByUserId: string | null;
  verifiedAt: Date;
  changeNote: string | null;
  linkedProductName: string | null;
}

export async function getManualEntryAuditLog(limit = 50): Promise<ManualEntryAuditRow[]> {
  const source = await prisma.dataSource.findUnique({ where: { name: MANUAL_ENTRY_SOURCE_NAME } });
  if (!source) return [];

  const records = await prisma.ingestionRecord.findMany({
    where: { sourceId: source.id },
    orderBy: { verifiedAt: "desc" },
    take: limit,
    include: {
      patent: { include: { drug: { select: { brandName: true } }, biologicProduct: { select: { proprietaryName: true } } } },
      exclusivity: { include: { drug: { select: { brandName: true } }, biologicProduct: { select: { proprietaryName: true } } } },
      genericChallenge: { include: { drugLinks: { include: { drug: { select: { brandName: true } } }, take: 1 } } },
      litigationCase: { include: { drugLinks: { include: { drug: { select: { brandName: true } } }, take: 1 } } },
    },
  });

  return records
    .map((r): ManualEntryAuditRow | null => {
      const base = { id: r.id, enteredByUserId: r.enteredByUserId, verifiedAt: r.verifiedAt, changeNote: r.changeNote };
      if (r.patent) {
        return { ...base, entityType: "patent", label: `Patent ${r.patent.patentNumber}`, linkedProductName: r.patent.drug?.brandName ?? r.patent.biologicProduct?.proprietaryName ?? null };
      }
      if (r.exclusivity) {
        return { ...base, entityType: "exclusivity", label: `Exclusivity ${r.exclusivity.code}`, linkedProductName: r.exclusivity.drug?.brandName ?? r.exclusivity.biologicProduct?.proprietaryName ?? null };
      }
      if (r.genericChallenge) {
        return { ...base, entityType: "generic_challenge", label: `${r.genericChallenge.rldName} challenge`, linkedProductName: r.genericChallenge.drugLinks[0]?.drug.brandName ?? null };
      }
      if (r.litigationCase) {
        return {
          ...base,
          entityType: "litigation_case",
          label: `${r.litigationCase.plaintiffNameRaw} v. ${r.litigationCase.defendantNameRaw}`,
          linkedProductName: r.litigationCase.drugLinks[0]?.drug.brandName ?? null,
        };
      }
      return null;
    })
    .filter((r): r is ManualEntryAuditRow => r !== null);
}
