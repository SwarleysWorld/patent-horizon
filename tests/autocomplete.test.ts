import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resetDb, createTestUser, type TestUser } from "./helpers";
import { autocomplete } from "@/lib/drugs/queries";
import { GET } from "@/app/api/search/autocomplete/route";

let subscriber: TestUser;

beforeEach(async () => {
  await resetDb();
  const company = await prisma.company.create({ data: { name: "Acme Pharma" } });
  await prisma.drug.create({
    data: {
      companyId: company.id, brandName: "Humalog", genericName: "insulin lispro",
      applicationType: "NDA", applicationNumber: "NDA100001", productNumber: "001",
      dosageForm: "INJECTION", route: "SUBCUTANEOUS", strength: "100U/ML",
    },
  });
  await prisma.drug.create({
    data: {
      companyId: company.id, brandName: "Humulin N", genericName: "insulin isophane human",
      applicationType: "NDA", applicationNumber: "NDA100002", productNumber: "001",
      dosageForm: "INJECTION", route: "SUBCUTANEOUS", strength: "100U/ML",
    },
  });
  await prisma.biologicProduct.create({
    data: {
      companyId: company.id, blaNumber: "BLA100003", productNumber: "001",
      proprietaryName: "Humira", properName: "adalimumab",
      licenseType: "STANDARD", center: "CDER",
      dosageForm: "INJECTION", route: "SUBCUTANEOUS", strength: "40MG",
    },
  });
  // A second strength of the same biologic — should collapse to one suggestion, not two.
  await prisma.biologicProduct.create({
    data: {
      companyId: company.id, blaNumber: "BLA100003", productNumber: "002",
      proprietaryName: "Humira", properName: "adalimumab",
      licenseType: "STANDARD", center: "CDER",
      dosageForm: "INJECTION", route: "SUBCUTANEOUS", strength: "20MG",
    },
  });
  subscriber = await createTestUser({ tier: "subscriber" });
});

describe("autocomplete (query layer)", () => {
  it("matches names across both sources", async () => {
    const results = await autocomplete("hum", 10);
    const names = results.map((r) => r.name);
    expect(names).toContain("Humalog");
    expect(names).toContain("Humulin N");
    expect(names).toContain("Humira");
  });

  it("collapses multiple rows sharing the same name into one suggestion", async () => {
    const results = await autocomplete("humira", 10);
    expect(results.filter((r) => r.name === "Humira")).toHaveLength(1);
  });

  it("returns nothing for a term matching nothing", async () => {
    const results = await autocomplete("zzzznonexistent", 10);
    expect(results).toHaveLength(0);
  });
});

describe("GET /api/search/autocomplete (route layer)", () => {
  function req(query: string, opts: { authenticated?: boolean } = { authenticated: true }) {
    return new NextRequest(`http://localhost:3000/api/search/autocomplete${query}`, {
      headers: opts.authenticated === false ? {} : { cookie: subscriber.cookie },
    });
  }

  it("returns 401 without a session", async () => {
    const res = await GET(req("?q=hum", { authenticated: false }));
    expect(res.status).toBe(401);
  });

  it("returns a structured 400 for an empty q", async () => {
    const res = await GET(req("?q="));
    expect(res.status).toBe(400);
  });

  it("returns 200 with matches", async () => {
    const res = await GET(req("?q=hum"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThan(0);
  });
});
