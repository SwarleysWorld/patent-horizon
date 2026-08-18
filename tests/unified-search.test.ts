import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resetDb, seedFixtures, createTestUser, type Fixtures, type TestUser } from "./helpers";
import { listDrugs } from "@/lib/drugs/queries";
import { ListDrugsQuerySchema } from "@/lib/drugs/schemas";
import { GET } from "@/app/api/drugs/route";

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

interface BiologicFixtures {
  companyId: string;
  standardBioId: string; // MONOCLONAL_ANTIBODY, substance patent w/ +200d PTA gap, ORPHAN exclusivity
  biosimilarBioId: string; // BIOSIMILAR, no patents, BPCIA_REF_PRODUCT exclusivity
}

// A small, separate fixture set (not folded into the shared seedFixtures,
// which several other test files assert an exact row count against) —
// just enough BiologicProduct/Patent/Exclusivity data to exercise the
// filters/sort/facets that only make sense once a second source exists.
async function seedBiologicFixtures(companyId: string): Promise<BiologicFixtures> {
  const standardBio = await prisma.biologicProduct.create({
    data: {
      companyId,
      blaNumber: "BLA900001",
      productNumber: "001",
      proprietaryName: "Biozumab",
      properName: "biozumab",
      licenseType: "STANDARD",
      center: "CDER",
      dosageForm: "INJECTION",
      route: "INTRAVENOUS",
      strength: "100MG",
      modality: "MONOCLONAL_ANTIBODY",
    },
  });
  await prisma.patent.create({
    data: {
      biologicProductId: standardBio.id,
      patentNumber: "9900001",
      coversDrugSubstance: true,
      nominalExpiryDate: daysFromNow(400),
      effectiveExpiryDate: daysFromNow(600),
      expiryAdjustmentDays: 200,
    },
  });
  await prisma.exclusivity.create({
    data: { biologicProductId: standardBio.id, code: "ORPHAN", expirationDate: daysFromNow(50) },
  });

  const biosimilarBio = await prisma.biologicProduct.create({
    data: {
      companyId,
      blaNumber: "BLA900002",
      productNumber: "001",
      proprietaryName: "Biosim-Alfa",
      properName: "biosimilab",
      licenseType: "BIOSIMILAR",
      center: "CBER",
      dosageForm: "INJECTION",
      route: "SUBCUTANEOUS",
      strength: "50MG",
      modality: "UNCLASSIFIED",
    },
  });
  await prisma.exclusivity.create({
    data: { biologicProductId: biosimilarBio.id, code: "BPCIA_REF_PRODUCT", expirationDate: daysFromNow(300) },
  });

  return { companyId, standardBioId: standardBio.id, biosimilarBioId: biosimilarBio.id };
}

let fx: Fixtures;
let bio: BiologicFixtures;
let subscriber: TestUser;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  bio = await seedBiologicFixtures(fx.companyId);
  subscriber = await createTestUser({ tier: "subscriber" });
});

function parsedQuery(params: Record<string, string> = {}) {
  return ListDrugsQuerySchema.parse(params);
}

describe("listDrugs — unified across Drug and BiologicProduct", () => {
  it("returns results from both sources when neither is filtered out", async () => {
    const result = await listDrugs(parsedQuery({ withinDays: "36500" }));
    const sources = new Set(result.data.map((d) => d.source));
    expect(sources.has("orange_book")).toBe(true);
    expect(sources.has("purple_book")).toBe(true);
  });

  it("source filter narrows to just one side", async () => {
    const result = await listDrugs(parsedQuery({ source: "purple_book", withinDays: "36500" }));
    expect(result.data.every((d) => d.source === "purple_book")).toBe(true);
    expect(result.data.map((d) => d.id)).toEqual(
      expect.arrayContaining([bio.standardBioId, bio.biosimilarBioId]),
    );
  });

  it("modality filter matches across both sources with the same enum", async () => {
    const result = await listDrugs(parsedQuery({ modality: "MONOCLONAL_ANTIBODY", withinDays: "36500" }));
    expect(result.data.map((d) => d.id)).toEqual([bio.standardBioId]);
  });

  it("q matches a biologic's proprietary/proper name the same way it matches a drug's brand/generic name", async () => {
    const result = await listDrugs(parsedQuery({ q: "biozumab", withinDays: "36500" }));
    expect(result.data.map((d) => d.id)).toEqual([bio.standardBioId]);
  });

  describe("minPtaGapDays — the core value-prop filter", () => {
    it("includes a result whose best patent meets the threshold", async () => {
      const result = await listDrugs(parsedQuery({ minPtaGapDays: "150", withinDays: "36500" }));
      expect(result.data.map((d) => d.id)).toContain(bio.standardBioId);
    });

    it("excludes results below the threshold, including ones with no known adjustment at all", async () => {
      const result = await listDrugs(parsedQuery({ minPtaGapDays: "150", withinDays: "36500" }));
      expect(result.data.map((d) => d.id)).not.toContain(bio.biosimilarBioId); // no patents at all
      expect(result.data.map((d) => d.id)).not.toContain(fx.alphaDrugId); // has a patent, but no known adjustment
    });

    it("reports the gap on the result row", async () => {
      const result = await listDrugs(parsedQuery({ minPtaGapDays: "150", withinDays: "36500" }));
      const row = result.data.find((d) => d.id === bio.standardBioId);
      expect(row?.maxPtaGapDays).toBe(200);
    });
  });

  it("sort=pta_gap_desc ranks the biggest gap first, nulls last", async () => {
    const result = await listDrugs(parsedQuery({ sort: "pta_gap_desc", withinDays: "36500" }));
    const ids = result.data.map((d) => d.id);
    expect(ids[0]).toBe(bio.standardBioId);
    // A result with no known adjustment (null) must sort after any known value.
    const nullIndex = ids.indexOf(bio.biosimilarBioId);
    expect(nullIndex).toBeGreaterThan(ids.indexOf(bio.standardBioId));
  });

  describe("patentType", () => {
    it("substance matches a patent with coversDrugSubstance", async () => {
      const result = await listDrugs(parsedQuery({ patentType: "substance", withinDays: "36500" }));
      expect(result.data.map((d) => d.id)).toContain(bio.standardBioId);
    });

    it("a result with zero patents never matches any patentType filter", async () => {
      const result = await listDrugs(parsedQuery({ patentType: "substance,product,use", withinDays: "36500" }));
      expect(result.data.map((d) => d.id)).not.toContain(bio.biosimilarBioId);
    });
  });

  describe("exclusivityCode", () => {
    it("matches a BPCIA-specific code, distinct from Orange Book's own codes", async () => {
      const result = await listDrugs(parsedQuery({ exclusivityCode: "BPCIA_REF_PRODUCT", withinDays: "36500" }));
      expect(result.data.map((d) => d.id)).toEqual([bio.biosimilarBioId]);
    });

    it("OR-combines multiple codes in one comma-separated param", async () => {
      const result = await listDrugs(
        parsedQuery({ exclusivityCode: "BPCIA_REF_PRODUCT,ORPHAN", withinDays: "36500" }),
      );
      expect(result.data.map((d) => d.id)).toEqual(
        expect.arrayContaining([bio.biosimilarBioId, bio.standardBioId]),
      );
    });
  });

  it("AND-combines separate filter categories", async () => {
    // source=purple_book AND modality=MONOCLONAL_ANTIBODY — only one fixture satisfies both.
    const result = await listDrugs(
      parsedQuery({ source: "purple_book", modality: "MONOCLONAL_ANTIBODY", withinDays: "36500" }),
    );
    expect(result.data.map((d) => d.id)).toEqual([bio.standardBioId]);
  });

  describe("facets", () => {
    it("returns counts for each configured dimension, scoped by every OTHER active filter", async () => {
      const result = await listDrugs(parsedQuery({ source: "purple_book", withinDays: "36500" }));
      // The `source` facet itself is computed EXCLUDING the source filter,
      // so it should still show counts for both sides, not just purple_book.
      const sourceFacet = result.facets.source;
      expect(sourceFacet.some((f) => f.value === "orange_book")).toBe(true);
      expect(sourceFacet.some((f) => f.value === "purple_book")).toBe(true);

      // The `modality` facet, by contrast, DOES respect the active source
      // filter (only its own dimension is excluded) — every current match
      // is purple_book, so its modality values should reflect only those.
      const modalityFacet = result.facets.modality;
      expect(modalityFacet.every((f) => ["MONOCLONAL_ANTIBODY", "UNCLASSIFIED"].includes(f.value))).toBe(true);
    });
  });
});

describe("GET /api/drugs (route layer) — new params", () => {
  function req(query: string) {
    return new NextRequest(`http://localhost:3000/api/drugs${query}`, { headers: { cookie: subscriber.cookie } });
  }

  it("accepts and applies comma-separated multi-value params end to end", async () => {
    const res = await GET(req("?source=purple_book,orange_book&withinDays=36500"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.total).toBeGreaterThan(0);
  });

  it("returns a structured 400 for an invalid source value", async () => {
    const res = await GET(req("?source=not_a_real_source"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("includes facets in the response envelope", async () => {
    const res = await GET(req("?withinDays=36500"));
    const body = await res.json();
    expect(body).toHaveProperty("facets");
    expect(body.facets).toHaveProperty("modality");
  });

  it("includes source/licenseType/maxPtaGapDays on each result", async () => {
    const res = await GET(req("?source=purple_book&withinDays=36500"));
    const body = await res.json();
    const row = body.data.find((d: { id: string }) => d.id === bio.standardBioId);
    expect(row).toMatchObject({ source: "purple_book", licenseType: "STANDARD", maxPtaGapDays: 200 });
  });
});
