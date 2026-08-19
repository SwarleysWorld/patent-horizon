import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, seedFixtures, createTestUser, type Fixtures, type TestUser } from "./helpers";
import { getDrugById } from "@/lib/drugs/queries";
import { GET } from "@/app/api/drugs/[id]/route";
import { prisma } from "@/lib/prisma";

let fx: Fixtures;
let subscriber: TestUser;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  subscriber = await createTestUser({ tier: "subscriber" });
});

describe("getDrugById (query layer)", () => {
  it("returns null for a nonexistent id", async () => {
    const result = await getDrugById("does-not-exist");
    expect(result).toBeNull();
  });

  it("includes full patent and exclusivity detail", async () => {
    const beta = await getDrugById(fx.betaMedId);
    expect(beta).not.toBeNull();
    expect(beta!.patents).toHaveLength(1);
    expect(beta!.exclusivities).toHaveLength(1);
    expect(beta!.patents[0].patentNumber).toBe("9000002");
    expect(beta!.exclusivities[0].code).toBe("NCE");
  });

  describe("genericEntryEstimate", () => {
    it("names the patent as controlling when it's the only barrier", async () => {
      const alpha = await getDrugById(fx.alphaDrugId);
      expect(alpha!.genericEntryEstimate.controllingType).toBe("patent");
      expect(alpha!.genericEntryEstimate.controllingId).toBe(fx.alphaDrugPatentId);
      expect(alpha!.genericEntryEstimate.date).toBe(alpha!.patents[0].effectiveExpiryDate);
    });

    it("names the exclusivity as controlling when it expires later than the patent", async () => {
      const beta = await getDrugById(fx.betaMedId);
      expect(beta!.genericEntryEstimate.controllingType).toBe("exclusivity");
      expect(beta!.genericEntryEstimate.controllingId).toBe(fx.betaMedExclusivityId);
      expect(beta!.genericEntryEstimate.date).toBe(beta!.exclusivities[0].expirationDate);
    });

    it("ignores a delisted patent — reports no known barrier", async () => {
      const zeta = await getDrugById(fx.zetaOldId);
      expect(zeta!.patents).toHaveLength(1); // still shown in the raw list
      expect(zeta!.genericEntryEstimate.date).toBeNull();
      expect(zeta!.genericEntryEstimate.controllingType).toBeNull();
      expect(zeta!.genericEntryEstimate.basis).toMatch(/no known barrier/i);
    });

    it("reports no known barrier for a drug with no patents or exclusivities", async () => {
      const epsilon = await getDrugById(fx.epsilonGenId);
      expect(epsilon!.patents).toHaveLength(0);
      expect(epsilon!.exclusivities).toHaveLength(0);
      expect(epsilon!.genericEntryEstimate.date).toBeNull();
    });

    it("still returns a past date as the estimate — a past barrier is still informative", async () => {
      const delta = await getDrugById(fx.deltaFormId);
      expect(delta!.genericEntryEstimate.date).not.toBeNull();
      expect(new Date(delta!.genericEntryEstimate.date!).getTime()).toBeLessThan(Date.now());
    });

    it("the controlling label is human-readable and includes the patent number", async () => {
      const alpha = await getDrugById(fx.alphaDrugId);
      expect(alpha!.genericEntryEstimate.controllingLabel).toContain("9000001");
    });

    it("flags pending_verification when the controlling patent has no expiryAdjustmentDays yet", async () => {
      const alpha = await getDrugById(fx.alphaDrugId);
      expect(alpha!.patents[0].expiryAdjustmentDays).toBeNull();
      expect(alpha!.genericEntryEstimate.dateConfidence).toBe("pending_verification");
      expect(alpha!.genericEntryEstimate.basis).toMatch(/not yet been checked against USPTO/i);
    });

    it("an exclusivity-controlled estimate is always confirmed — no USPTO adjustment process applies to it", async () => {
      const beta = await getDrugById(fx.betaMedId);
      expect(beta!.genericEntryEstimate.dateConfidence).toBe("confirmed");
    });

    it("a patent-controlled estimate is confirmed once its expiryAdjustmentDays is set", async () => {
      await prisma.patent.update({
        where: { id: fx.alphaDrugPatentId },
        data: { expiryAdjustmentDays: 30 },
      });
      const alpha = await getDrugById(fx.alphaDrugId);
      expect(alpha!.genericEntryEstimate.dateConfidence).toBe("confirmed");
    });

    it("dateConfidence is null when there's no known barrier", async () => {
      const epsilon = await getDrugById(fx.epsilonGenId);
      expect(epsilon!.genericEntryEstimate.dateConfidence).toBeNull();
    });
  });

  it("includes company info", async () => {
    const alpha = await getDrugById(fx.alphaDrugId);
    expect(alpha!.company.name).toBe("Acme Pharma");
  });

  it("includes modality and drugClass", async () => {
    const beta = await getDrugById(fx.betaMedId);
    expect(beta!.modality).toBe("SMALL_MOLECULE");
    expect(beta!.drugClass).toBe("Statin");

    const gamma = await getDrugById(fx.gammaCureId);
    expect(gamma!.modality).toBe("PEPTIDE");
    expect(gamma!.drugClass).toBeNull();
  });
});

describe("GET /api/drugs/[id] (route layer)", () => {
  function req(id: string, opts: { authenticated?: boolean } = { authenticated: true }) {
    return new NextRequest(`http://localhost:3000/api/drugs/${id}`, {
      headers: opts.authenticated === false ? {} : { cookie: subscriber.cookie },
    });
  }

  async function callRoute(id: string, opts?: { authenticated?: boolean }) {
    return GET(req(id, opts), { params: Promise.resolve({ id }) });
  }

  it("returns 401 without a session", async () => {
    const res = await callRoute(fx.alphaDrugId, { authenticated: false });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 200 with a data envelope for a real drug", async () => {
    const res = await callRoute(fx.alphaDrugId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(fx.alphaDrugId);
  });

  it("returns a structured 404 for a missing drug", async () => {
    const res = await callRoute("does-not-exist");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("does-not-exist");
  });
});
