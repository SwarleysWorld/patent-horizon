import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { unauthorizedResponse, internalErrorResponse } from "@/lib/api/errors";

// Read-only, service-to-service endpoint for Markman (a separate product,
// separate database, separate user base) to check whether a patent it's
// analyzing also exists in our USPTO/FDA-verified data. Deliberately NOT
// registered in src/lib/openapi/spec.ts — this is an internal contract,
// not part of the public API surface.
//
// Auth is a shared-secret header, not a session cookie: this has no
// concept of a Patent Horizon user at all, on purpose. Every query below
// touches only Patent/Exclusivity/GenericChallenge/LitigationCase/
// LitigationDocket and Drug/BiologicProduct (for a display name) via
// explicit `select` field lists — never User, Session, Account,
// WatchlistItem, or anything else tied to a subscriber. That whitelist is
// the actual isolation boundary; it's enforced by what's written below,
// not by a database permission that could be widened later without
// anyone noticing.
function isAuthorized(request: NextRequest): boolean {
  const provided = request.headers.get("x-internal-api-key");
  const expected = process.env.INTERNAL_LOOKUP_API_KEY;
  return Boolean(expected) && provided === expected;
}

function toDigitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorizedResponse("Missing or invalid internal API key.");

  const rawPatentNumber = request.nextUrl.searchParams.get("patentNumber");
  if (!rawPatentNumber) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "patentNumber query parameter is required." } },
      { status: 400 },
    );
  }
  const patentNumber = toDigitsOnly(rawPatentNumber);

  try {
    const patents = await prisma.patent.findMany({
      where: { patentNumber },
      select: {
        drugId: true,
        biologicProductId: true,
        useCode: true,
        coversDrugSubstance: true,
        coversDrugProduct: true,
        nominalExpiryDate: true,
        effectiveExpiryDate: true,
        expiryAdjustmentDays: true,
        drug: { select: { brandName: true, genericName: true } },
        biologicProduct: { select: { proprietaryName: true, properName: true } },
      },
    });

    const matches = await Promise.all(
      patents.map(async (patent) => {
        const [exclusivities, challengeLinks, litigationLinks] = await Promise.all([
          prisma.exclusivity.findMany({
            where: patent.drugId ? { drugId: patent.drugId } : { biologicProductId: patent.biologicProductId },
            select: { code: true, description: true, expirationDate: true },
          }),
          patent.drugId
            ? prisma.genericChallengeDrug.findMany({
                where: { drugId: patent.drugId },
                select: {
                  genericChallenge: {
                    select: { currentStatus: true, submissionDate: true, submissionDateType: true },
                  },
                },
              })
            : Promise.resolve([]),
          patent.drugId
            ? prisma.litigationCaseDrug.findMany({
                where: { drugId: patent.drugId },
                select: {
                  litigationCase: {
                    select: {
                      outcome: true,
                      earliestFilingDate: true,
                      matchConfidence: true,
                      dockets: { select: { docketNumber: true, court: true, filingDate: true } },
                    },
                  },
                },
              })
            : Promise.resolve([]),
        ]);

        return {
          associatedProduct: patent.drug
            ? { type: "drug" as const, name: `${patent.drug.brandName} (${patent.drug.genericName})` }
            : { type: "biologic" as const, name: patent.biologicProduct!.proprietaryName },
          patent: {
            useCode: patent.useCode || null,
            coversDrugSubstance: patent.coversDrugSubstance,
            coversDrugProduct: patent.coversDrugProduct,
            nominalExpiryDate: patent.nominalExpiryDate,
            effectiveExpiryDate: patent.effectiveExpiryDate,
            expiryAdjustmentDays: patent.expiryAdjustmentDays,
          },
          exclusivities: exclusivities.map((e) => ({
            code: e.code,
            description: e.description,
            expirationDate: e.expirationDate,
          })),
          // "On file for the associated drug" — GenericChallenge/LitigationCase
          // link to Drug via a join table, not directly to Patent, so this is
          // genuinely drug-level history, not proof this specific patent was
          // litigated. Markman's presentation must not blur that distinction.
          paragraphIVHistory: {
            hasChallenges: challengeLinks.length > 0,
            challenges: challengeLinks.map((c) => ({
              currentStatus: c.genericChallenge.currentStatus,
              submissionDate: c.genericChallenge.submissionDate,
              submissionDateType: c.genericChallenge.submissionDateType,
            })),
          },
          litigation: {
            hasCases: litigationLinks.length > 0,
            cases: litigationLinks.map((l) => ({
              outcome: l.litigationCase.outcome,
              earliestFilingDate: l.litigationCase.earliestFilingDate,
              matchConfidence: l.litigationCase.matchConfidence,
              dockets: l.litigationCase.dockets.map((d) => ({
                docketNumber: d.docketNumber,
                court: d.court,
                filingDate: d.filingDate,
              })),
            })),
          },
        };
      }),
    );

    return NextResponse.json({ data: { patentNumber, matches } });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
