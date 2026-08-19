import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resetDb, seedFixtures, createTestUser, type Fixtures, type TestUser } from "./helpers";
import { listDrugs } from "@/lib/drugs/queries";
import { ListDrugsQuerySchema } from "@/lib/drugs/schemas";
import { GET } from "@/app/api/drugs/route";

let fx: Fixtures;
let subscriber: TestUser;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  subscriber = await createTestUser({ tier: "subscriber" });
});

function parsedQuery(params: Record<string, string> = {}) {
  const result = ListDrugsQuerySchema.parse(params);
  return result;
}

describe("listDrugs (query layer)", () => {
  it("only returns drugs with a known patent or exclusivity — excludes drugs with neither", async () => {
    const result = await listDrugs(parsedQuery());
    const ids = result.data.map((d) => d.id);
    expect(ids).not.toContain(fx.epsilonGenId);
  });

  it("treats a delisted-only patent as no barrier — excludes that drug too", async () => {
    const result = await listDrugs(parsedQuery());
    const ids = result.data.map((d) => d.id);
    expect(ids).not.toContain(fx.zetaOldId);
  });

  it("sorts soonest-expiring first by default", async () => {
    const result = await listDrugs(parsedQuery());
    const ids = result.data.map((d) => d.id);
    // alpha (+10d) < beta (exclusivity +200d) < gamma (+1000d) — delta is
    // in the past so it should sort before all of them.
    expect(ids.indexOf(fx.deltaFormId)).toBeLessThan(ids.indexOf(fx.alphaDrugId));
    expect(ids.indexOf(fx.alphaDrugId)).toBeLessThan(ids.indexOf(fx.betaMedId));
    expect(ids.indexOf(fx.betaMedId)).toBeLessThan(ids.indexOf(fx.gammaCureId));
  });

  it("sort=entry_desc reverses the order", async () => {
    const result = await listDrugs(parsedQuery({ sort: "entry_desc" }));
    const ids = result.data.map((d) => d.id);
    expect(ids.indexOf(fx.gammaCureId)).toBeLessThan(ids.indexOf(fx.betaMedId));
    expect(ids.indexOf(fx.betaMedId)).toBeLessThan(ids.indexOf(fx.alphaDrugId));
  });

  it("includes already-past estimated entry dates by default (no lower bound)", async () => {
    const result = await listDrugs(parsedQuery());
    const delta = result.data.find((d) => d.id === fx.deltaFormId);
    expect(delta).toBeDefined();
    expect(new Date(delta!.estimatedGenericEntryDate!).getTime()).toBeLessThan(Date.now());
  });

  it("uses the exclusivity date when it's later than the patent date", async () => {
    const result = await listDrugs(parsedQuery());
    const beta = result.data.find((d) => d.id === fx.betaMedId);
    expect(beta).toBeDefined();
    // beta's patent is +100d, its exclusivity is +200d — expect ~+200d.
    const daysOut = (new Date(beta!.estimatedGenericEntryDate!).getTime() - Date.now()) / 86_400_000;
    expect(daysOut).toBeGreaterThan(190);
    expect(daysOut).toBeLessThan(210);
  });

  describe("withinDays filter", () => {
    it("excludes drugs whose estimate falls outside the window", async () => {
      const result = await listDrugs(parsedQuery({ withinDays: "50" }));
      const ids = result.data.map((d) => d.id);
      expect(ids).toContain(fx.alphaDrugId); // +10d, inside
      expect(ids).toContain(fx.deltaFormId); // already past, inside
      expect(ids).not.toContain(fx.betaMedId); // +200d, outside
      expect(ids).not.toContain(fx.gammaCureId); // +1000d, outside
    });

    it("a wide enough window includes everything with a known date", async () => {
      const result = await listDrugs(parsedQuery({ withinDays: "36500" }));
      const ids = result.data.map((d) => d.id);
      expect(ids).toEqual(
        expect.arrayContaining([fx.alphaDrugId, fx.betaMedId, fx.gammaCureId, fx.deltaFormId]),
      );
    });
  });

  describe("search (q)", () => {
    it("matches brand name, case-insensitively", async () => {
      const result = await listDrugs(parsedQuery({ q: "alphadrug" }));
      expect(result.data.map((d) => d.id)).toEqual([fx.alphaDrugId]);
    });

    it("matches generic name", async () => {
      const result = await listDrugs(parsedQuery({ q: "betaine" }));
      expect(result.data.map((d) => d.id)).toEqual([fx.betaMedId]);
    });

    it("matches a substring in the middle of the name", async () => {
      const result = await listDrugs(parsedQuery({ q: "ammazol" }));
      expect(result.data.map((d) => d.id)).toEqual([fx.gammaCureId]);
    });

    it("treats a literal % in the search term as a literal character, not a wildcard", async () => {
      const result = await listDrugs(parsedQuery({ q: "alpha%drug" }));
      expect(result.data).toHaveLength(0);
    });

    it("returns no results for a term matching nothing", async () => {
      const result = await listDrugs(parsedQuery({ q: "nonexistent-drug-xyz" }));
      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it("matches company name", async () => {
      const result = await listDrugs(parsedQuery({ q: "acme", withinDays: "36500" }));
      const ids = result.data.map((d) => d.id);
      expect(ids).toEqual(
        expect.arrayContaining([fx.alphaDrugId, fx.betaMedId, fx.gammaCureId, fx.deltaFormId]),
      );
    });
  });

  describe("advanced search filters", () => {
    it("modality filters to drugs with that exact modality", async () => {
      const result = await listDrugs(parsedQuery({ modality: "PEPTIDE", withinDays: "36500" }));
      expect(result.data.map((d) => d.id)).toEqual([fx.gammaCureId]);
    });

    it("drugClass filters to drugs with that exact tag", async () => {
      const result = await listDrugs(parsedQuery({ drugClass: "Statin", withinDays: "36500" }));
      expect(result.data.map((d) => d.id)).toEqual([fx.betaMedId]);
    });

    it("applicationType filters exactly", async () => {
      const result = await listDrugs(parsedQuery({ applicationType: "ANDA", withinDays: "36500" }));
      const ids = result.data.map((d) => d.id);
      expect(ids).toContain(fx.gammaCureId); // ANDA
      expect(ids).not.toContain(fx.alphaDrugId); // NDA
    });

    it("dosageForm filters exactly", async () => {
      const result = await listDrugs(parsedQuery({ dosageForm: "INJECTABLE", withinDays: "36500" }));
      expect(result.data.map((d) => d.id)).toEqual([fx.gammaCureId]);
    });

    it("expiresAfter excludes estimates before the given date", async () => {
      // alpha (+10d) and delta (past) should drop out of a window starting +50d.
      const after = new Date(Date.now() + 50 * 86_400_000).toISOString().slice(0, 10);
      const result = await listDrugs(parsedQuery({ expiresAfter: after, withinDays: "36500" }));
      const ids = result.data.map((d) => d.id);
      expect(ids).not.toContain(fx.alphaDrugId);
      expect(ids).not.toContain(fx.deltaFormId);
      expect(ids).toContain(fx.betaMedId);
      expect(ids).toContain(fx.gammaCureId);
    });

    it("expiresBefore excludes estimates after the given date", async () => {
      const before = new Date(Date.now() + 50 * 86_400_000).toISOString().slice(0, 10);
      const result = await listDrugs(parsedQuery({ expiresBefore: before, withinDays: "36500" }));
      const ids = result.data.map((d) => d.id);
      expect(ids).toContain(fx.alphaDrugId);
      expect(ids).toContain(fx.deltaFormId);
      expect(ids).not.toContain(fx.betaMedId);
      expect(ids).not.toContain(fx.gammaCureId);
    });

    it("combines multiple advanced filters with AND", async () => {
      const result = await listDrugs(
        parsedQuery({ applicationType: "NDA", drugClass: "Statin", withinDays: "36500" }),
      );
      expect(result.data.map((d) => d.id)).toEqual([fx.betaMedId]);
    });

    it("a filter matching nothing returns an empty page, not an error", async () => {
      const result = await listDrugs(parsedQuery({ modality: "MONOCLONAL_ANTIBODY", withinDays: "36500" }));
      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });
  });

  describe("pagination", () => {
    it("respects limit and reports hasMore correctly", async () => {
      const page1 = await listDrugs(parsedQuery({ limit: "2", withinDays: "36500" }));
      expect(page1.data).toHaveLength(2);
      expect(page1.pagination).toMatchObject({ limit: 2, offset: 0, total: 4, hasMore: true });

      const page2 = await listDrugs(parsedQuery({ limit: "2", offset: "2", withinDays: "36500" }));
      expect(page2.data).toHaveLength(2);
      expect(page2.pagination).toMatchObject({ limit: 2, offset: 2, total: 4, hasMore: false });

      // No overlap between pages.
      const page1Ids = page1.data.map((d) => d.id);
      const page2Ids = page2.data.map((d) => d.id);
      expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
    });

    it("an offset past the end returns an empty page, not an error", async () => {
      const result = await listDrugs(parsedQuery({ offset: "9999", withinDays: "36500" }));
      expect(result.data).toHaveLength(0);
      expect(result.pagination.hasMore).toBe(false);
    });
  });

  it("includes patent and exclusivity counts", async () => {
    const result = await listDrugs(parsedQuery({ q: "betamed" }));
    expect(result.data[0]).toMatchObject({ patentCount: 1, exclusivityCount: 1 });
  });

  describe("dateConfidence", () => {
    it("is pending_verification when an unverified patent controls the estimate", async () => {
      const result = await listDrugs(parsedQuery({ q: "alphadrug" }));
      expect(result.data[0].dateConfidence).toBe("pending_verification");
    });

    it("is confirmed when an exclusivity controls the estimate", async () => {
      const result = await listDrugs(parsedQuery({ q: "betamed" }));
      expect(result.data[0].dateConfidence).toBe("confirmed");
    });

    it("is confirmed once the controlling patent's expiryAdjustmentDays is set", async () => {
      await prisma.patent.update({
        where: { id: fx.alphaDrugPatentId },
        data: { expiryAdjustmentDays: 30 },
      });
      const result = await listDrugs(parsedQuery({ q: "alphadrug" }));
      expect(result.data[0].dateConfidence).toBe("confirmed");
    });
  });
});

describe("GET /api/drugs (route layer)", () => {
  function req(query: string, opts: { authenticated?: boolean } = { authenticated: true }) {
    return new NextRequest(`http://localhost:3000/api/drugs${query}`, {
      headers: opts.authenticated === false ? {} : { cookie: subscriber.cookie },
    });
  }

  it("returns 401 without a session", async () => {
    const res = await GET(req("", { authenticated: false }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 200 for any authenticated tier (Subscribers can read the product)", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(200);
  });

  it("returns 200 with data + pagination envelope", async () => {
    const res = await GET(req("?withinDays=36500"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("pagination");
  });

  it("returns a structured 400 for an out-of-range limit", async () => {
    const res = await GET(req("?limit=9999"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "limit" })]),
    );
  });

  it("returns a structured 400 for a negative offset", async () => {
    const res = await GET(req("?offset=-1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns a structured 400 for an invalid sort value", async () => {
    const res = await GET(req("?sort=bogus"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.details[0].field).toBe("sort");
  });

  it("returns a structured 400 for a non-integer withinDays", async () => {
    const res = await GET(req("?withinDays=soon"));
    expect(res.status).toBe(400);
  });

  it("defaults limit to 20 when omitted", async () => {
    const res = await GET(req(""));
    const body = await res.json();
    expect(body.pagination.limit).toBe(20);
  });

  it("returns a structured 400 for an invalid modality", async () => {
    const res = await GET(req("?modality=NOT_REAL"));
    expect(res.status).toBe(400);
    const body = await res.json();
    // modality is now a comma-separated multi-value param, validated as an
    // array under the hood — the path points at the specific invalid
    // element ("modality.0" for the first/only one here), not just the
    // param name.
    expect(body.error.details[0].field).toBe("modality.0");
  });

  it("returns a structured 400 for a malformed expiresAfter date", async () => {
    const res = await GET(req("?expiresAfter=not-a-date"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.details[0].field).toBe("expiresAfter");
  });

  it("includes modality and drugClass on each returned drug", async () => {
    const res = await GET(req("?withinDays=36500"));
    const body = await res.json();
    const beta = body.data.find((d: { id: string }) => d.id === fx.betaMedId);
    expect(beta).toMatchObject({ modality: "SMALL_MOLECULE", drugClass: "Statin" });
  });

  it("filters via query params end to end", async () => {
    const res = await GET(req("?modality=PEPTIDE&withinDays=36500"));
    const body = await res.json();
    expect(body.data.map((d: { id: string }) => d.id)).toEqual([fx.gammaCureId]);
  });
});

describe("Prisma sanity", () => {
  it("fixtures were actually inserted", async () => {
    const count = await prisma.drug.count();
    expect(count).toBe(6);
  });
});
