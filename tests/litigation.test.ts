import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./helpers";
import {
  splitCaseName,
  normalizeCompanyName,
  matchCompanyByName,
  resolveRole,
  scoreConfidence,
  deriveCaseOutcome,
  toLitigationCourt,
  type CompanyRef,
} from "@/lib/ingestion/litigation/match";
import { loadHitsForCompany } from "@/lib/ingestion/litigation/load";
import type { RecapSearchHit, RowIssue } from "@/lib/ingestion/litigation/types";

describe("splitCaseName", () => {
  it("splits a standard 'Plaintiff v. Defendant' caption", () => {
    expect(splitCaseName("Vanda Pharmaceuticals Inc. v. Teva Pharmaceuticals USA, Inc.")).toEqual({
      plaintiffRaw: "Vanda Pharmaceuticals Inc.",
      defendantRaw: "Teva Pharmaceuticals USA, Inc.",
    });
  });

  it("handles 'vs.' as well as 'v.'", () => {
    expect(splitCaseName("WYETH vs. TEVA PHARMACEUTICALS")).toEqual({
      plaintiffRaw: "WYETH",
      defendantRaw: "TEVA PHARMACEUTICALS",
    });
  });

  it("returns null when there's no clean two-way split", () => {
    expect(splitCaseName("In re: Some Multi-District Litigation")).toBeNull();
  });

  it("returns null when a side would be empty", () => {
    expect(splitCaseName("v. Teva")).toBeNull();
  });
});

describe("normalizeCompanyName", () => {
  it("strips corporate suffixes and lowercases", () => {
    expect(normalizeCompanyName("Teva Pharmaceuticals USA, Inc.")).toBe("teva");
    expect(normalizeCompanyName("TEVA PHARMACEUTICALS USA INC")).toBe("teva");
  });

  it("leaves a bare proper noun alone", () => {
    expect(normalizeCompanyName("Wyeth")).toBe("wyeth");
  });

  it("strips multiple trailing suffix tokens", () => {
    expect(normalizeCompanyName("Amneal Pharmaceuticals of New York LLC")).toBe("amneal pharmaceuticals of new york");
  });
});

describe("matchCompanyByName", () => {
  function toMap(companies: CompanyRef[]): Map<string, CompanyRef[]> {
    const map = new Map<string, CompanyRef[]>();
    for (const c of companies) {
      const key = normalizeCompanyName(c.name);
      const bucket = map.get(key) ?? [];
      bucket.push(c);
      map.set(key, bucket);
    }
    return map;
  }

  it("matches exactly when normalized names are identical", () => {
    const map = toMap([{ id: "1", name: "Teva Pharmaceuticals USA, Inc." }]);
    const result = matchCompanyByName("TEVA PHARMACEUTICALS USA INC", map);
    expect(result).toEqual({ company: { id: "1", name: "Teva Pharmaceuticals USA, Inc." }, matchType: "exact" });
  });

  it("falls back to fuzzy match when the shorter name's tokens are all contained in the longer one", () => {
    const map = toMap([{ id: "1", name: "Teva Pharmaceutical Industries Ltd" }]);
    const result = matchCompanyByName("Teva", map);
    expect(result.matchType).toBe("fuzzy");
    expect(result.company?.id).toBe("1");
  });

  it("never guesses among multiple fuzzy candidates", () => {
    const map = toMap([
      { id: "1", name: "Pharma Corp X" },
      { id: "2", name: "Pharma Corp Y" },
    ]);
    const result = matchCompanyByName("Pharma", map);
    expect(result).toEqual({ company: null, matchType: "none" });
  });

  it("returns none for a name with no plausible match", () => {
    const map = toMap([{ id: "1", name: "Wyeth" }]);
    expect(matchCompanyByName("Completely Unrelated Co", map)).toEqual({ company: null, matchType: "none" });
  });
});

describe("resolveRole", () => {
  it("resolves plaintiff when the searched company matches the plaintiff side", () => {
    const role = resolveRole(
      "our-id",
      { company: { id: "our-id", name: "Wyeth" }, matchType: "exact" },
      { company: { id: "other-id", name: "Teva" }, matchType: "exact" },
    );
    expect(role).toBe("plaintiff");
  });

  it("resolves defendant when the searched company matches the defendant side", () => {
    const role = resolveRole(
      "our-id",
      { company: { id: "other-id", name: "Wyeth" }, matchType: "exact" },
      { company: { id: "our-id", name: "Teva" }, matchType: "exact" },
    );
    expect(role).toBe("defendant");
  });

  it("resolves unmatched when the searched company matches neither side", () => {
    const role = resolveRole(
      "our-id",
      { company: { id: "a", name: "Wyeth" }, matchType: "exact" },
      { company: { id: "b", name: "Teva" }, matchType: "exact" },
    );
    expect(role).toBe("unmatched");
  });
});

describe("scoreConfidence", () => {
  const exactMatch = { company: { id: "c1", name: "X" }, matchType: "exact" as const };
  const fuzzyMatch = { company: { id: "c1", name: "X" }, matchType: "fuzzy" as const };
  const noMatch = { company: null, matchType: "none" as const };

  it("scores HIGH for an exact double match, one candidate drug, and a patent nature-of-suit", () => {
    const result = scoreConfidence({
      role: "plaintiff",
      plaintiffMatch: exactMatch,
      defendantMatch: exactMatch,
      candidateDrugIds: ["drug-1"],
      natureOfSuit: "830 Patent",
      cause: null,
    });
    expect(result.tier).toBe("HIGH");
  });

  it("scores MEDIUM when the product link is ambiguous (multiple candidates)", () => {
    const result = scoreConfidence({
      role: "plaintiff",
      plaintiffMatch: exactMatch,
      defendantMatch: exactMatch,
      candidateDrugIds: ["drug-1", "drug-2"],
      natureOfSuit: "830 Patent",
      cause: null,
    });
    expect(result.tier).toBe("MEDIUM");
  });

  it("scores MEDIUM when the defendant doesn't resolve to any known company", () => {
    const result = scoreConfidence({
      role: "plaintiff",
      plaintiffMatch: exactMatch,
      defendantMatch: noMatch,
      candidateDrugIds: ["drug-1"],
      natureOfSuit: "830 Patent",
      cause: null,
    });
    expect(result.tier).toBe("MEDIUM");
  });

  it("scores LOW when nature-of-suit/cause doesn't look like a patent case", () => {
    const result = scoreConfidence({
      role: "plaintiff",
      plaintiffMatch: exactMatch,
      defendantMatch: exactMatch,
      candidateDrugIds: ["drug-1"],
      natureOfSuit: "442 Civil Rights: Jobs",
      cause: "28:1441 Notice of Removal - Employment Discrim",
    });
    expect(result.tier).toBe("LOW");
  });

  it("scores LOW when the role is unmatched", () => {
    const result = scoreConfidence({
      role: "unmatched",
      plaintiffMatch: noMatch,
      defendantMatch: noMatch,
      candidateDrugIds: [],
      natureOfSuit: "830 Patent",
      cause: null,
    });
    expect(result.tier).toBe("LOW");
  });

  it("scores LOW when the plaintiff match was only fuzzy", () => {
    const result = scoreConfidence({
      role: "plaintiff",
      plaintiffMatch: fuzzyMatch,
      defendantMatch: exactMatch,
      candidateDrugIds: ["drug-1"],
      natureOfSuit: "830 Patent",
      cause: null,
    });
    expect(result.tier).toBe("LOW");
  });
});

describe("deriveCaseOutcome", () => {
  it("is ONGOING when at least one docket has no termination date", () => {
    expect(deriveCaseOutcome([{ dateTerminated: "2020-01-01" }, { dateTerminated: null }]).outcome).toBe("ONGOING");
  });

  it("is UNCLEAR when every docket is terminated", () => {
    expect(deriveCaseOutcome([{ dateTerminated: "2020-01-01" }, { dateTerminated: "2021-01-01" }]).outcome).toBe("UNCLEAR");
  });
});

describe("toLitigationCourt", () => {
  it("maps deld/njd to DE/NJ and rejects anything else", () => {
    expect(toLitigationCourt("deld")).toBe("DE");
    expect(toLitigationCourt("njd")).toBe("NJ");
    expect(toLitigationCourt("cand")).toBeNull();
  });
});

describe("loadHitsForCompany — case grouping across dockets", () => {
  let brandCompanyId: string;
  let genericCompanyId: string;
  let sourceId: string;

  beforeEach(async () => {
    await resetDb();
    const brand = await prisma.company.create({ data: { name: "Wyeth" } });
    brandCompanyId = brand.id;
    const generic = await prisma.company.create({ data: { name: "Teva Pharmaceuticals USA, Inc." } });
    genericCompanyId = generic.id;
    const drug = await prisma.drug.create({
      data: {
        companyId: brandCompanyId,
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
    const challenge = await prisma.genericChallenge.create({
      data: {
        naturalKeyNda: "NDA999999",
        activeIngredient: "testinib",
        dosageForm: "TABLET",
        strength: "10MG",
        rldName: "TestBrand",
        rldNdaNumber: "NDA999999",
        submissionDateType: "EXACT_DATE",
        decisionHistory: [],
        rawStrengthText: "10MG",
      },
    });
    await prisma.genericChallengeDrug.create({ data: { genericChallengeId: challenge.id, drugId: drug.id } });
    const source = await prisma.dataSource.create({ data: { name: "test-litigation-source" } });
    sourceId = source.id;
  });

  function makeHit(overrides: Partial<RecapSearchHit>): RecapSearchHit {
    return {
      externalDocketId: 1,
      caseName: "Wyeth v. Teva Pharmaceuticals USA, Inc.",
      docketNumber: "1:23-cv-00001",
      courtId: "njd",
      dateFiled: "2023-01-01",
      dateTerminated: null,
      assignedTo: "Jane Doe",
      natureOfSuit: "830 Patent",
      cause: "35:271 Patent Infringement",
      ...overrides,
    };
  }

  it("groups two dockets for the same party pair filed 30 days apart into one LitigationCase", async () => {
    const companies: CompanyRef[] = [
      { id: brandCompanyId, name: "Wyeth" },
      { id: genericCompanyId, name: "Teva Pharmaceuticals USA, Inc." },
    ];
    const companiesByNormalizedName = new Map<string, CompanyRef[]>();
    for (const c of companies) companiesByNormalizedName.set(normalizeCompanyName(c.name), [c]);

    const issues: RowIssue[] = [];
    const hit1 = makeHit({ externalDocketId: 101, docketNumber: "1:23-cv-00001", dateFiled: "2023-01-01" });
    const hit2 = makeHit({ externalDocketId: 102, docketNumber: "1:23-cv-00002", dateFiled: "2023-01-31" });

    await loadHitsForCompany([hit1, hit2], { id: brandCompanyId, name: "Wyeth" }, companiesByNormalizedName, {
      sourceId,
      verifiedAt: new Date(),
      issues,
    });

    const cases = await prisma.litigationCase.findMany({ include: { dockets: true } });
    expect(cases).toHaveLength(1);
    expect(cases[0].dockets).toHaveLength(2);
  });

  it("does not group two dockets for the same party pair filed more than 180 days apart", async () => {
    const companies: CompanyRef[] = [
      { id: brandCompanyId, name: "Wyeth" },
      { id: genericCompanyId, name: "Teva Pharmaceuticals USA, Inc." },
    ];
    const companiesByNormalizedName = new Map<string, CompanyRef[]>();
    for (const c of companies) companiesByNormalizedName.set(normalizeCompanyName(c.name), [c]);

    const issues: RowIssue[] = [];
    const hit1 = makeHit({ externalDocketId: 201, docketNumber: "1:23-cv-00003", dateFiled: "2023-01-01" });
    const hit2 = makeHit({ externalDocketId: 202, docketNumber: "1:24-cv-00004", dateFiled: "2023-09-01" });

    await loadHitsForCompany([hit1, hit2], { id: brandCompanyId, name: "Wyeth" }, companiesByNormalizedName, {
      sourceId,
      verifiedAt: new Date(),
      issues,
    });

    const cases = await prisma.litigationCase.findMany({ include: { dockets: true } });
    expect(cases).toHaveLength(2);
  });

  it("links the case to the brand company's challenged Drug and scores HIGH confidence", async () => {
    const companies: CompanyRef[] = [
      { id: brandCompanyId, name: "Wyeth" },
      { id: genericCompanyId, name: "Teva Pharmaceuticals USA, Inc." },
    ];
    const companiesByNormalizedName = new Map<string, CompanyRef[]>();
    for (const c of companies) companiesByNormalizedName.set(normalizeCompanyName(c.name), [c]);

    const issues: RowIssue[] = [];
    const hit = makeHit({ externalDocketId: 301 });

    const result = await loadHitsForCompany([hit], { id: brandCompanyId, name: "Wyeth" }, companiesByNormalizedName, {
      sourceId,
      verifiedAt: new Date(),
      issues,
    });

    expect(result.confidenceCounts.HIGH).toBe(1);
    const links = await prisma.litigationCaseDrug.findMany();
    expect(links).toHaveLength(1);

    const cases = await prisma.litigationCase.findMany();
    expect(cases[0].matchConfidence).toBe("HIGH");
    expect(cases[0].outcome).toBe("ONGOING");
  });

  it("logs an issue and skips a hit outside DE/NJ", async () => {
    const companiesByNormalizedName = new Map<string, CompanyRef[]>();
    const issues: RowIssue[] = [];
    const hit = makeHit({ courtId: "cand", externalDocketId: 401 });

    await loadHitsForCompany([hit], { id: brandCompanyId, name: "Wyeth" }, companiesByNormalizedName, {
      sourceId,
      verifiedAt: new Date(),
      issues,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toMatch(/outside DE\/NJ/);
    const cases = await prisma.litigationCase.findMany();
    expect(cases).toHaveLength(0);
  });

  it("logs an issue and skips a hit whose caseName doesn't split cleanly", async () => {
    const companiesByNormalizedName = new Map<string, CompanyRef[]>();
    const issues: RowIssue[] = [];
    const hit = makeHit({ caseName: "In re: Some MDL", externalDocketId: 402 });

    await loadHitsForCompany([hit], { id: brandCompanyId, name: "Wyeth" }, companiesByNormalizedName, {
      sourceId,
      verifiedAt: new Date(),
      issues,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toMatch(/caseName/);
  });
});
