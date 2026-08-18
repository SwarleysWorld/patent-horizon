import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, seedFixtures, createTestUser, type TestUser } from "./helpers";
import { getFilterOptions } from "@/lib/drugs/queries";
import { GET } from "@/app/api/drugs/filter-options/route";

let subscriber: TestUser;

beforeEach(async () => {
  await resetDb();
  await seedFixtures();
  subscriber = await createTestUser({ tier: "subscriber" });
});

describe("getFilterOptions (query layer)", () => {
  it("offers every modality, even ones with zero current matches", async () => {
    const options = await getFilterOptions();
    const values = options.modalities.map((m) => m.value);
    expect(values).toEqual([
      "SMALL_MOLECULE",
      "PEPTIDE",
      "OLIGONUCLEOTIDE",
      "MONOCLONAL_ANTIBODY",
      "CELL_THERAPY",
      "GENE_THERAPY",
      "VACCINE",
      "OTHER",
      "UNCLASSIFIED",
    ]);
  });

  it("offers every application type, even BLA which has zero matches in Orange Book data", async () => {
    const options = await getFilterOptions();
    expect(options.applicationTypes).toEqual(["NDA", "ANDA", "BLA"]);
  });

  it("returns the fixed drug-class label vocabulary", async () => {
    const options = await getFilterOptions();
    expect(options.drugClasses).toContain("Statin");
  });

  it("returns only dosageForm values actually present in the data, deduplicated", async () => {
    const options = await getFilterOptions();
    // Fixtures use TABLET, CAPSULE, INJECTABLE.
    expect(options.dosageForms.sort()).toEqual(["CAPSULE", "INJECTABLE", "TABLET"]);
  });
});

describe("GET /api/drugs/filter-options (route layer)", () => {
  function req(opts: { authenticated?: boolean } = { authenticated: true }) {
    return new NextRequest("http://localhost:3000/api/drugs/filter-options", {
      headers: opts.authenticated === false ? {} : { cookie: subscriber.cookie },
    });
  }

  it("returns 401 without a session", async () => {
    const res = await GET(req({ authenticated: false }));
    expect(res.status).toBe(401);
  });

  it("returns 200 with the filter option vocabulary", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty("modalities");
    expect(body.data).toHaveProperty("drugClasses");
    expect(body.data).toHaveProperty("applicationTypes");
    expect(body.data).toHaveProperty("dosageForms");
  });
});
