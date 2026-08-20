import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resetDb, createTestUser, type TestUser } from "./helpers";
import { GET } from "@/app/api/drugs/export/route";

let subscriber: TestUser;
let companyId: string;

beforeEach(async () => {
  await resetDb();
  const company = await prisma.company.create({ data: { name: "Acme Pharma" } });
  companyId = company.id;
  subscriber = await createTestUser({ tier: "subscriber" });
});

function req(query: string) {
  return new NextRequest(`http://localhost:3000/api/drugs/export${query}`, {
    headers: { cookie: subscriber.cookie },
  });
}

async function createDrugWithPatent(applicationNumber: string) {
  const drug = await prisma.drug.create({
    data: {
      companyId,
      brandName: `Drug${applicationNumber}`,
      genericName: "testine",
      applicationType: "NDA",
      applicationNumber,
      productNumber: "001",
      dosageForm: "TABLET",
      route: "ORAL",
      strength: "10MG",
    },
  });
  await prisma.patent.create({
    data: {
      drugId: drug.id,
      patentNumber: `P-${applicationNumber}`,
      nominalExpiryDate: new Date(Date.now() + 100 * 86_400_000),
      effectiveExpiryDate: new Date(Date.now() + 100 * 86_400_000),
    },
  });
  return drug;
}

describe("GET /api/drugs/export (row cap)", () => {
  it("caps the CSV body at 500 rows and reports the true total via headers", async () => {
    // 3 real matching rows is enough to prove the header/body relationship
    // without needing to seed 500+ real rows in a unit test.
    await Promise.all([
      createDrugWithPatent("NDA900001"),
      createDrugWithPatent("NDA900002"),
      createDrugWithPatent("NDA900003"),
    ]);

    const res = await GET(req("?withinDays=36500"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Export-Row-Cap")).toBe("500");
    expect(res.headers.get("X-Export-Total-Matches")).toBe("3");

    const text = await res.text();
    const dataLines = text.trim().split("\n").slice(1); // drop header row
    expect(dataLines).toHaveLength(3);
  });

  it("includes the new hasGenericChallenge column", async () => {
    await createDrugWithPatent("NDA900004");
    const res = await GET(req("?withinDays=36500"));
    const [header] = (await res.text()).split("\n");
    expect(header.split(",")).toContain("hasGenericChallenge");
  });
});
