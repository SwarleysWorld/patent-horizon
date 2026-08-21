import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb, createTestUser, type TestUser } from "./helpers";
import {
  MANUAL_ENTRY_SOURCE_NAME,
  createManualPatent,
  createManualExclusivity,
  createManualGenericChallenge,
  createManualLitigationCase,
  linkManualEntryToProduct,
  getUnlinkedManualEntries,
} from "@/lib/ingestion/manualEntry";
import { scoreManualLitigationMatch } from "@/lib/ingestion/manualEntry/match";
import type { CompanyMatch } from "@/lib/ingestion/litigation/match";

let analyst: TestUser;
let companyId: string;
let drugId: string;
let secondDrugId: string;

beforeEach(async () => {
  await resetDb();
  analyst = await createTestUser({ tier: "analyst" });
  const company = await prisma.company.create({ data: { name: "Wyeth" } });
  companyId = company.id;
  const drug = await prisma.drug.create({
    data: {
      companyId,
      brandName: "TestBrand",
      genericName: "testinib",
      applicationType: "NDA",
      applicationNumber: "NDA999999",
      productNumber: "001",
      dosageForm: "TABLET",
      route: "ORAL",
      strength: "10MG",
    },
  });
  drugId = drug.id;
  const drug2 = await prisma.drug.create({
    data: {
      companyId,
      brandName: "TestBrand ER",
      genericName: "testinib",
      applicationType: "NDA",
      applicationNumber: "NDA999999",
      productNumber: "002",
      dosageForm: "CAPSULE, EXTENDED RELEASE",
      route: "ORAL",
      strength: "20MG",
    },
  });
  secondDrugId = drug2.id;
});

async function latestIngestionRecordFor(field: "patentId" | "exclusivityId" | "genericChallengeId" | "litigationCaseId", id: string) {
  return prisma.ingestionRecord.findFirst({
    where: { [field]: id },
    include: { source: true },
    orderBy: { verifiedAt: "desc" },
  });
}

describe("createManualPatent", () => {
  it("saves a patent attached to a real product and records provenance", async () => {
    const res = await createManualPatent(
      {
        productId: drugId,
        productSource: "orange_book",
        patentNumber: "9999999",
        coversDrugSubstance: true,
        coversDrugProduct: false,
        useCode: "",
        filingDate: "2010-01-01",
        nominalExpiryDate: "2030-01-01",
        effectiveExpiryDate: "2030-06-01",
        expiryAdjustmentDays: 151,
        submittedDate: null,
      },
      analyst.userId,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");

    const patent = await prisma.patent.findUniqueOrThrow({ where: { id: res.data.patentId } });
    expect(patent.drugId).toBe(drugId);
    expect(patent.patentNumber).toBe("9999999");

    const record = await latestIngestionRecordFor("patentId", res.data.patentId);
    expect(record?.source.name).toBe(MANUAL_ENTRY_SOURCE_NAME);
    expect(record?.enteredByUserId).toBe(analyst.userId);
  });
});

describe("createManualExclusivity", () => {
  it("saves an exclusivity attached to a real product and records provenance", async () => {
    const res = await createManualExclusivity(
      { productId: drugId, productSource: "orange_book", code: "NCE", description: null, grantedDate: null, expirationDate: "2028-01-01" },
      analyst.userId,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");

    const exclusivity = await prisma.exclusivity.findUniqueOrThrow({ where: { id: res.data.exclusivityId } });
    expect(exclusivity.drugId).toBe(drugId);

    const record = await latestIngestionRecordFor("exclusivityId", res.data.exclusivityId);
    expect(record?.source.name).toBe(MANUAL_ENTRY_SOURCE_NAME);
    expect(record?.enteredByUserId).toBe(analyst.userId);
  });
});

describe("createManualGenericChallenge — NDA matching", () => {
  it("auto-links when the NDA resolves to exactly one Drug", async () => {
    const res = await createManualGenericChallenge(
      {
        activeIngredient: "testinib",
        dosageForm: "TABLET",
        strength: "10MG",
        rldName: "TestBrand",
        rldNdaNumber: "NDA999999",
        submissionDateType: "EXACT_DATE",
        submissionDate: "2020-01-01",
        confirmedDrugId: drugId, // the UI resolves this via previewGenericChallengeMatch before submit; here we simulate an already-confirmed single match
      },
      analyst.userId,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");

    const links = await prisma.genericChallengeDrug.findMany({ where: { genericChallengeId: res.data.challengeId } });
    expect(links).toHaveLength(1);
    expect(links[0].drugId).toBe(drugId);

    const record = await latestIngestionRecordFor("genericChallengeId", res.data.challengeId);
    expect(record?.source.name).toBe(MANUAL_ENTRY_SOURCE_NAME);
    expect(record?.enteredByUserId).toBe(analyst.userId);
  });

  it("saves unlinked when no confirmedDrugId is given (ambiguous or no match), and surfaces it in getUnlinkedManualEntries", async () => {
    const res = await createManualGenericChallenge(
      {
        activeIngredient: "testinib",
        dosageForm: "UNKNOWN FORM",
        strength: "5MG",
        rldName: "TestBrand",
        rldNdaNumber: null, // no NDA — matching was never attempted
        submissionDateType: "PRE_MMA",
        submissionDate: null,
        confirmedDrugId: null,
      },
      analyst.userId,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");

    const links = await prisma.genericChallengeDrug.findMany({ where: { genericChallengeId: res.data.challengeId } });
    expect(links).toHaveLength(0);

    const unlinked = await getUnlinkedManualEntries();
    expect(unlinked.some((e) => e.id === res.data.challengeId && e.entityType === "generic_challenge")).toBe(true);
  });
});

describe("scoreManualLitigationMatch", () => {
  const exact = (id: string, name: string): CompanyMatch => ({ company: { id, name }, matchType: "exact" });
  const none: CompanyMatch = { company: null, matchType: "none" };

  it("HIGH — both parties matched exactly, one candidate product, patent-shaped nature of suit", () => {
    const score = scoreManualLitigationMatch({
      plaintiffMatch: exact("c1", "Wyeth"),
      defendantMatch: exact("c2", "Teva"),
      candidateDrugIds: ["drug-1"],
      natureOfSuit: "830 Patent",
      cause: null,
    });
    expect(score.tier).toBe("HIGH");
  });

  it("NONE — neither party name resolved to a known company", () => {
    const score = scoreManualLitigationMatch({
      plaintiffMatch: none,
      defendantMatch: none,
      candidateDrugIds: [],
      natureOfSuit: "830 Patent",
      cause: null,
    });
    expect(score.tier).toBe("NONE");
  });

  it("LOW — matches are fuzzy and nature of suit doesn't look like a patent case", () => {
    const score = scoreManualLitigationMatch({
      plaintiffMatch: { company: { id: "c1", name: "Wyeth" }, matchType: "fuzzy" },
      defendantMatch: none,
      candidateDrugIds: [],
      natureOfSuit: "442 Civil Rights: Jobs",
      cause: null,
    });
    expect(score.tier).toBe("LOW");
  });
});

describe("createManualLitigationCase", () => {
  it("HIGH confidence: saves and links to the confirmed product", async () => {
    const res = await createManualLitigationCase(
      {
        plaintiffNameRaw: "Wyeth",
        defendantNameRaw: "Teva Pharmaceuticals USA, Inc.",
        plaintiffCompanyId: companyId,
        defendantCompanyId: null,
        confirmedDrugId: drugId,
        matchConfidence: "HIGH",
        matchNote: "Exact match on both parties.",
        docket: {
          docketNumber: "1:23-cv-00001",
          court: "DE",
          externalDocketId: 12345,
          filingDate: "2023-01-01",
          dateTerminated: null,
          judge: "Jane Doe",
          natureOfSuit: "830 Patent",
        },
      },
      analyst.userId,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");

    const litCase = await prisma.litigationCase.findUniqueOrThrow({ where: { id: res.data.caseId }, include: { dockets: true, drugLinks: true } });
    expect(litCase.matchConfidence).toBe("HIGH");
    expect(litCase.dockets).toHaveLength(1);
    expect(litCase.dockets[0].externalDocketId).toBe(12345);
    expect(litCase.drugLinks).toHaveLength(1);
    expect(litCase.drugLinks[0].drugId).toBe(drugId);
    expect(litCase.outcome).toBe("ONGOING");

    const record = await latestIngestionRecordFor("litigationCaseId", res.data.caseId);
    expect(record?.source.name).toBe(MANUAL_ENTRY_SOURCE_NAME);
    expect(record?.enteredByUserId).toBe(analyst.userId);
    expect(record?.externalRef).toBe("12345");
  });

  it("NONE confidence: saves unlinked (stored as LOW, zero product links) and surfaces in getUnlinkedManualEntries", async () => {
    const res = await createManualLitigationCase(
      {
        plaintiffNameRaw: "Some Unrelated Party",
        defendantNameRaw: "Another Unrelated Party",
        plaintiffCompanyId: null,
        defendantCompanyId: null,
        confirmedDrugId: null,
        matchConfidence: "NONE",
        matchNote: "Neither party name resolved to a known company.",
        docket: {
          docketNumber: "1:23-cv-00099",
          court: "NJ",
          externalDocketId: null,
          filingDate: null,
          dateTerminated: null,
          judge: null,
          natureOfSuit: null,
        },
      },
      analyst.userId,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");

    const litCase = await prisma.litigationCase.findUniqueOrThrow({ where: { id: res.data.caseId }, include: { drugLinks: true, dockets: true } });
    expect(litCase.matchConfidence).toBe("LOW"); // NONE has no schema value — stored as LOW, see manualEntry/types.ts
    expect(litCase.drugLinks).toHaveLength(0);
    expect(litCase.dockets[0].externalDocketId).toBeNull(); // fully hand-typed, no CourtListener lookup

    const unlinked = await getUnlinkedManualEntries();
    expect(unlinked.some((e) => e.id === res.data.caseId && e.entityType === "litigation_case")).toBe(true);
  });

  it("allows two manually-entered dockets with no externalDocketId to coexist (nullable unique)", async () => {
    const make = (docketNumber: string) =>
      createManualLitigationCase(
        {
          plaintiffNameRaw: "A",
          defendantNameRaw: "B",
          plaintiffCompanyId: null,
          defendantCompanyId: null,
          confirmedDrugId: null,
          matchConfidence: "NONE",
          matchNote: null,
          docket: { docketNumber, court: "DE", externalDocketId: null, filingDate: null, dateTerminated: null, judge: null, natureOfSuit: null },
        },
        analyst.userId,
      );
    // Sequential, not Promise.all — this is testing the nullable-unique
    // constraint's coexistence property, not a concurrency guarantee, and
    // two genuinely concurrent $transactions here both racing
    // ensureManualEntryDataSource()'s upsert can hit a real Postgres
    // deadlock (confirmed live), unrelated to what this test is about.
    const a = await make("1:24-cv-00001");
    const b = await make("1:24-cv-00002");
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

describe("linkManualEntryToProduct", () => {
  it("links a previously-unlinked generic challenge and logs a second IngestionRecord", async () => {
    const created = await createManualGenericChallenge(
      {
        activeIngredient: "testinib",
        dosageForm: "TABLET",
        strength: "10MG",
        rldName: "TestBrand",
        rldNdaNumber: null,
        submissionDateType: "EXACT_DATE",
        submissionDate: "2021-01-01",
        confirmedDrugId: null,
      },
      analyst.userId,
    );
    if (!created.ok) throw new Error("unreachable");

    const before = await getUnlinkedManualEntries();
    expect(before.some((e) => e.id === created.data.challengeId)).toBe(true);

    const linked = await linkManualEntryToProduct("generic_challenge", created.data.challengeId, secondDrugId, analyst.userId);
    expect(linked.ok).toBe(true);

    const links = await prisma.genericChallengeDrug.findMany({ where: { genericChallengeId: created.data.challengeId } });
    expect(links).toHaveLength(1);
    expect(links[0].drugId).toBe(secondDrugId);

    const after = await getUnlinkedManualEntries();
    expect(after.some((e) => e.id === created.data.challengeId)).toBe(false);

    const records = await prisma.ingestionRecord.findMany({ where: { genericChallengeId: created.data.challengeId }, orderBy: { verifiedAt: "asc" } });
    expect(records).toHaveLength(2); // one for the original entry, one for the later link
    expect(records[1].changeNote).toMatch(/Manually linked/);
  });
});
