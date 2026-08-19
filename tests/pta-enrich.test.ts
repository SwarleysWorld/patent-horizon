import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./helpers";
import { enrichOnePatent, ensurePtaDataSource, type PatentCandidate } from "@/lib/ingestion/pta/enrich";
import type { UsptoOdpClient } from "@/lib/ingestion/pta/client";

function fakeClient(filingDate: string, adjustmentTotalQuantity: number): UsptoOdpClient {
  return {
    lookupByPatentNumber: async () => ({
      status: "found",
      filingDate,
      adjustmentTotalQuantity,
      raw: {},
    }),
  } as unknown as UsptoOdpClient;
}

let companyId: string;
let drugId: string;

beforeEach(async () => {
  await resetDb();
  const company = await prisma.company.create({ data: { name: "Acme Pharma" } });
  companyId = company.id;
  const drug = await prisma.drug.create({
    data: {
      companyId,
      brandName: "TestDrug", genericName: "testinib",
      applicationType: "NDA", applicationNumber: "NDA999999", productNumber: "001",
      dosageForm: "TABLET", route: "ORAL", strength: "10MG",
    },
  });
  drugId = drug.id;
});

describe("enrichOnePatent — UTC date arithmetic regression", () => {
  it("REGRESSION: a standard patent with 0 days of PTA computes effectiveExpiryDate as EXACTLY filingDate + 20 years, not one day earlier", async () => {
    // Real bug caught live: USPTO's filingDate ("2001-11-01") parses as UTC
    // midnight; the original code mutated it with local-time setters
    // (setFullYear/setDate), which silently shifted the result a day
    // earlier in any timezone west of UTC. This is exactly the case that
    // failed: 0 days of adjustment should mean the effective date is
    // identical to the naive 20-year statutory date, not offset by one.
    const patent = await prisma.patent.create({
      data: {
        drugId,
        patentNumber: "6716602",
        nominalExpiryDate: new Date("2021-11-01"),
        effectiveExpiryDate: new Date("2021-11-01"),
      },
    });
    const source = await ensurePtaDataSource();
    const client = fakeClient("2001-11-01", 0);

    const candidate: PatentCandidate = {
      id: patent.id,
      patentNumber: patent.patentNumber,
      drugId,
      biologicProductId: null,
      nominalExpiryDate: patent.nominalExpiryDate,
      effectiveExpiryDate: patent.effectiveExpiryDate,
      expiryAdjustmentDays: null,
    };

    const outcome = await enrichOnePatent(client, source.id, candidate, new Date());
    expect(outcome.kind).toBe("updated");
    if (outcome.kind !== "updated") throw new Error("unreachable");
    expect(outcome.after.effective.toISOString().slice(0, 10)).toBe("2021-11-01");
    expect(outcome.after.adjustment).toBe(0);

    const updated = await prisma.patent.findUniqueOrThrow({ where: { id: patent.id } });
    expect(updated.effectiveExpiryDate.toISOString().slice(0, 10)).toBe("2021-11-01");
  });

  it("applies a positive PTA adjustment correctly on top of the UTC-correct baseline", async () => {
    const patent = await prisma.patent.create({
      data: {
        drugId,
        patentNumber: "7000000",
        nominalExpiryDate: new Date("2025-06-15"),
        effectiveExpiryDate: new Date("2025-06-15"),
      },
    });
    const source = await ensurePtaDataSource();
    const client = fakeClient("2005-06-15", 200);

    const candidate: PatentCandidate = {
      id: patent.id,
      patentNumber: patent.patentNumber,
      drugId,
      biologicProductId: null,
      nominalExpiryDate: patent.nominalExpiryDate,
      effectiveExpiryDate: patent.effectiveExpiryDate,
      expiryAdjustmentDays: null,
    };

    const outcome = await enrichOnePatent(client, source.id, candidate, new Date());
    expect(outcome.kind).toBe("updated");
    if (outcome.kind !== "updated") throw new Error("unreachable");
    // filingDate + 20y = 2025-06-15, + 200 days of PTA.
    expect(outcome.after.effective.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(outcome.after.adjustment).toBe(200);
  });
});
