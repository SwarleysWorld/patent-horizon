import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./helpers";
import { getDrugById, listDrugs } from "@/lib/drugs/queries";
import { ListDrugsQuerySchema } from "@/lib/drugs/schemas";

let companyId: string;

beforeEach(async () => {
  await resetDb();
  const company = await prisma.company.create({ data: { name: "Acme Pharma" } });
  companyId = company.id;
});

function parsedQuery(params: Record<string, string> = {}) {
  return ListDrugsQuerySchema.parse(params);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

async function createDrug(overrides: { applicationNumber?: string; brandName?: string } = {}) {
  return prisma.drug.create({
    data: {
      companyId,
      brandName: "TestDrug",
      genericName: "testine",
      applicationType: "NDA",
      applicationNumber: "NDA999901",
      productNumber: "001",
      dosageForm: "TABLET",
      route: "ORAL",
      strength: "10MG",
      ...overrides,
    },
  });
}

describe("GenericChallenge (query layer)", () => {
  describe("getDrugById", () => {
    it("includes linked generic challenges, most-recent-submission-first", async () => {
      const drug = await createDrug();
      const challenge = await prisma.genericChallenge.create({
        data: {
          naturalKeyNda: "NDA999901",
          activeIngredient: "testine",
          dosageForm: "TABLET",
          strength: "10MG",
          rldName: "TestDrug",
          rldNdaNumber: "NDA999901",
          submissionDateType: "EXACT_DATE",
          submissionDate: new Date("2020-01-01T00:00:00.000Z"),
          decisionHistory: [{ status: "ELIGIBLE", postingDate: "2021-01-01", rawStatusText: "Eligible" }],
          currentStatus: "ELIGIBLE",
          rawStrengthText: "10MG",
        },
      });
      await prisma.genericChallengeDrug.create({ data: { genericChallengeId: challenge.id, drugId: drug.id } });

      const detail = await getDrugById(drug.id);
      expect(detail!.genericChallenges).toHaveLength(1);
      expect(detail!.genericChallenges[0]).toMatchObject({
        id: challenge.id,
        currentStatus: "ELIGIBLE",
        submissionDate: "2020-01-01",
      });
    });

    it("returns an empty array for a drug with no linked challenge — the overwhelming majority", async () => {
      const drug = await createDrug();
      const detail = await getDrugById(drug.id);
      expect(detail!.genericChallenges).toEqual([]);
    });
  });

  describe("listDrugs filters", () => {
    it("hasGenericChallenge excludes drugs with no linked challenge", async () => {
      const withChallenge = await createDrug({ applicationNumber: "NDA999901", brandName: "HasChallenge" });
      const withoutChallenge = await createDrug({ applicationNumber: "NDA999902", brandName: "NoChallenge" });
      await prisma.patent.create({
        data: { drugId: withChallenge.id, patentNumber: "P1", nominalExpiryDate: daysFromNow(100), effectiveExpiryDate: daysFromNow(100) },
      });
      await prisma.patent.create({
        data: { drugId: withoutChallenge.id, patentNumber: "P2", nominalExpiryDate: daysFromNow(100), effectiveExpiryDate: daysFromNow(100) },
      });
      const challenge = await prisma.genericChallenge.create({
        data: {
          naturalKeyNda: "NDA999901",
          activeIngredient: "testine",
          dosageForm: "TABLET",
          strength: "10MG",
          rldName: "HasChallenge",
          rldNdaNumber: "NDA999901",
          submissionDateType: "EXACT_DATE",
          submissionDate: new Date("2020-01-01T00:00:00.000Z"),
          decisionHistory: [],
          rawStrengthText: "10MG",
        },
      });
      await prisma.genericChallengeDrug.create({ data: { genericChallengeId: challenge.id, drugId: withChallenge.id } });

      const filtered = await listDrugs(parsedQuery({ hasGenericChallenge: "true" }));
      const ids = filtered.data.map((d) => d.id);
      expect(ids).toContain(withChallenge.id);
      expect(ids).not.toContain(withoutChallenge.id);

      const unfiltered = await listDrugs(parsedQuery());
      expect(unfiltered.data.map((d) => d.id)).toEqual(expect.arrayContaining([withChallenge.id, withoutChallenge.id]));
    });

    it("hasFirstCommercialMarketingDate excludes drugs whose linked challenge has no marketing date on file", async () => {
      const marketed = await createDrug({ applicationNumber: "NDA999903", brandName: "Marketed" });
      const notMarketed = await createDrug({ applicationNumber: "NDA999904", brandName: "NotMarketed" });
      for (const d of [marketed, notMarketed]) {
        await prisma.patent.create({
          data: { drugId: d.id, patentNumber: `P-${d.id}`, nominalExpiryDate: daysFromNow(100), effectiveExpiryDate: daysFromNow(100) },
        });
      }
      const marketedChallenge = await prisma.genericChallenge.create({
        data: {
          naturalKeyNda: "NDA999903",
          activeIngredient: "testine",
          dosageForm: "TABLET",
          strength: "10MG",
          rldName: "Marketed",
          rldNdaNumber: "NDA999903",
          submissionDateType: "EXACT_DATE",
          submissionDate: new Date("2020-01-01T00:00:00.000Z"),
          dateOfFirstCommercialMarketing: new Date("2022-06-01T00:00:00.000Z"),
          decisionHistory: [],
          rawStrengthText: "10MG",
        },
      });
      await prisma.genericChallengeDrug.create({ data: { genericChallengeId: marketedChallenge.id, drugId: marketed.id } });
      const notMarketedChallenge = await prisma.genericChallenge.create({
        data: {
          naturalKeyNda: "NDA999904",
          activeIngredient: "testine",
          dosageForm: "TABLET",
          strength: "10MG",
          rldName: "NotMarketed",
          rldNdaNumber: "NDA999904",
          submissionDateType: "EXACT_DATE",
          submissionDate: new Date("2020-01-01T00:00:00.000Z"),
          decisionHistory: [],
          rawStrengthText: "10MG",
        },
      });
      await prisma.genericChallengeDrug.create({ data: { genericChallengeId: notMarketedChallenge.id, drugId: notMarketed.id } });

      const filtered = await listDrugs(parsedQuery({ hasFirstCommercialMarketingDate: "true" }));
      const ids = filtered.data.map((d) => d.id);
      expect(ids).toContain(marketed.id);
      expect(ids).not.toContain(notMarketed.id);
    });

    it("SearchResult.hasGenericChallenge reflects the link", async () => {
      const drug = await createDrug({ applicationNumber: "NDA999905" });
      await prisma.patent.create({
        data: { drugId: drug.id, patentNumber: "P5", nominalExpiryDate: daysFromNow(100), effectiveExpiryDate: daysFromNow(100) },
      });
      const before = await listDrugs(parsedQuery({ q: "testdrug" }));
      expect(before.data[0].hasGenericChallenge).toBe(false);

      const challenge = await prisma.genericChallenge.create({
        data: {
          naturalKeyNda: "NDA999905",
          activeIngredient: "testine",
          dosageForm: "TABLET",
          strength: "10MG",
          rldName: "TestDrug",
          rldNdaNumber: "NDA999905",
          submissionDateType: "EXACT_DATE",
          decisionHistory: [],
          rawStrengthText: "10MG",
        },
      });
      await prisma.genericChallengeDrug.create({ data: { genericChallengeId: challenge.id, drugId: drug.id } });

      const after = await listDrugs(parsedQuery({ q: "testdrug" }));
      expect(after.data[0].hasGenericChallenge).toBe(true);
    });

    it("Purple Book (biologic) results are never flagged as having a generic challenge — the mechanism is ANDA-only", async () => {
      const bp = await prisma.biologicProduct.create({
        data: {
          companyId,
          blaNumber: "BLA9999",
          productNumber: "001",
          proprietaryName: "TestBio",
          properName: "testibio",
          licenseType: "STANDARD",
          center: "CDER",
          dosageForm: "INJECTION",
          route: "INTRAVENOUS",
          strength: "100MG",
        },
      });
      await prisma.exclusivity.create({ data: { biologicProductId: bp.id, code: "ORPHAN", expirationDate: daysFromNow(100) } });
      const result = await listDrugs(parsedQuery({ source: "purple_book" }));
      expect(result.data.every((d) => d.hasGenericChallenge === false)).toBe(true);
    });
  });
});
