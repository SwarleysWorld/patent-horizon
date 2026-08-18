import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resetDb, createTestUser, type TestUser } from "./helpers";
import { getBiologicById } from "@/lib/drugs/queries";
import { GET } from "@/app/api/biologics/[id]/route";

let subscriber: TestUser;
let companyId: string;

beforeEach(async () => {
  await resetDb();
  const company = await prisma.company.create({ data: { name: "Acme Biologics" } });
  companyId = company.id;
  subscriber = await createTestUser({ tier: "subscriber" });
});

describe("getBiologicById (query layer)", () => {
  it("returns null for a nonexistent id", async () => {
    expect(await getBiologicById("does-not-exist")).toBeNull();
  });

  it("resolves a real reference-product relationship", async () => {
    const reference = await prisma.biologicProduct.create({
      data: {
        companyId,
        blaNumber: "BLA1", productNumber: "001",
        proprietaryName: "OriginalMab", properName: "originalmab",
        licenseType: "STANDARD", center: "CDER",
        dosageForm: "INJECTION", route: "INTRAVENOUS", strength: "100MG",
      },
    });
    const biosimilar = await prisma.biologicProduct.create({
      data: {
        companyId,
        blaNumber: "BLA2", productNumber: "001",
        proprietaryName: "CopyMab", properName: "copymab-abcd",
        licenseType: "BIOSIMILAR", center: "CDER",
        dosageForm: "INJECTION", route: "INTRAVENOUS", strength: "100MG",
        referenceProductId: reference.id,
      },
    });

    const detail = await getBiologicById(biosimilar.id);
    expect(detail?.referenceProduct).toMatchObject({ id: reference.id, proprietaryName: "OriginalMab" });
    expect(detail?.referenceProductNameRaw).toBeNull();

    const referenceDetail = await getBiologicById(reference.id);
    expect(referenceDetail?.biosimilarsAndInterchangeables).toEqual([
      expect.objectContaining({ id: biosimilar.id, proprietaryName: "CopyMab" }),
    ]);
  });

  it("preserves the raw source name when reference-product resolution failed at ingestion time", async () => {
    const biologic = await prisma.biologicProduct.create({
      data: {
        companyId,
        blaNumber: "BLA3", productNumber: "001",
        proprietaryName: "OrphanMab", properName: "orphanmab",
        licenseType: "BIOSIMILAR", center: "CDER",
        dosageForm: "INJECTION", route: "INTRAVENOUS", strength: "100MG",
        referenceProductNameRaw: "Some Unmatched Reference",
      },
    });
    const detail = await getBiologicById(biologic.id);
    expect(detail?.referenceProduct).toBeNull();
    expect(detail?.referenceProductNameRaw).toBe("Some Unmatched Reference");
  });

  it("computes genericEntryEstimate from the biologic's own patents/exclusivities", async () => {
    const biologic = await prisma.biologicProduct.create({
      data: {
        companyId,
        blaNumber: "BLA4", productNumber: "001",
        proprietaryName: "GapMab", properName: "gapmab",
        licenseType: "STANDARD", center: "CDER",
        dosageForm: "INJECTION", route: "INTRAVENOUS", strength: "100MG",
      },
    });
    await prisma.exclusivity.create({
      data: { biologicProductId: biologic.id, code: "ORPHAN", expirationDate: new Date(Date.now() + 100 * 86_400_000) },
    });
    const detail = await getBiologicById(biologic.id);
    expect(detail?.genericEntryEstimate.controllingType).toBe("exclusivity");
    expect(detail?.genericEntryEstimate.date).not.toBeNull();
  });
});

describe("GET /api/biologics/[id] (route layer)", () => {
  function req(id: string, opts: { authenticated?: boolean } = { authenticated: true }) {
    return new NextRequest(`http://localhost:3000/api/biologics/${id}`, {
      headers: opts.authenticated === false ? {} : { cookie: subscriber.cookie },
    });
  }

  it("returns 401 without a session", async () => {
    const res = await GET(req("whatever", { authenticated: false }), { params: Promise.resolve({ id: "whatever" }) });
    expect(res.status).toBe(401);
  });

  it("returns a structured 404 for a missing biologic", async () => {
    const res = await GET(req("does-not-exist"), { params: Promise.resolve({ id: "does-not-exist" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 200 with a data envelope for a real biologic", async () => {
    const biologic = await prisma.biologicProduct.create({
      data: {
        companyId,
        blaNumber: "BLA5", productNumber: "001",
        proprietaryName: "RouteMab", properName: "routemab",
        licenseType: "STANDARD", center: "CDER",
        dosageForm: "INJECTION", route: "INTRAVENOUS", strength: "100MG",
      },
    });
    const res = await GET(req(biologic.id), { params: Promise.resolve({ id: biologic.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(biologic.id);
    expect(body.data.proprietaryName).toBe("RouteMab");
  });
});
