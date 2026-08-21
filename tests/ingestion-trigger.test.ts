import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resetDb, createTestUser, type TestUser } from "./helpers";

// Real pipelines are network/PDF/rate-limit-bound (FDA downloads, USPTO API
// calls) and must never actually run in this test file — every pipeline's
// entry-point function is mocked below, hoisted so the vi.mock() factories
// (themselves hoisted by Vitest to the top of the file) can reference the
// same makeFakeRun helper. The fake still does the real minimal DB
// bookkeeping (DataSource upsert + IngestionRun RUNNING -> SUCCESS) so the
// orchestrator's DB-backed concurrency guard has something real to check.
const { makeFakeRun } = vi.hoisted(() => {
  function makeFakeRun(sourceName: string) {
    return vi.fn(async () => {
      const { prisma } = await import("@/lib/prisma");
      const source = await prisma.dataSource.upsert({ where: { name: sourceName }, update: {}, create: { name: sourceName } });
      const run = await prisma.ingestionRun.create({ data: { sourceId: source.id, status: "RUNNING" } });
      await prisma.ingestionRun.update({ where: { id: run.id }, data: { status: "SUCCESS", finishedAt: new Date() } });
      return { status: "SUCCESS" };
    });
  }
  return { makeFakeRun };
});

const ORANGE_BOOK_SOURCE_NAME = "FDA Orange Book";
const PURPLE_BOOK_SOURCE_NAME = "FDA Purple Book";
const PARAGRAPH_IV_SOURCE_NAME = "FDA Paragraph IV Certifications List";
const PTA_SOURCE_NAME = "USPTO Patent Term Adjustment (ODP)";

vi.mock("@/lib/ingestion/orangeBook", () => ({
  ORANGE_BOOK_SOURCE_NAME,
  runOrangeBookIngestion: makeFakeRun(ORANGE_BOOK_SOURCE_NAME),
}));
vi.mock("@/lib/ingestion/purpleBook", () => ({
  PURPLE_BOOK_SOURCE_NAME,
  runPurpleBookIngestion: makeFakeRun(PURPLE_BOOK_SOURCE_NAME),
}));
vi.mock("@/lib/ingestion/paragraphIV", () => ({
  PARAGRAPH_IV_SOURCE_NAME,
  runParagraphIVIngestion: makeFakeRun(PARAGRAPH_IV_SOURCE_NAME),
}));
vi.mock("@/lib/ingestion/pta", () => ({
  PTA_SOURCE_NAME,
  runPtaEnrichment: makeFakeRun(PTA_SOURCE_NAME),
}));

const { POST } = await import("@/app/api/data/ingest/route");
const { runOrangeBookIngestion } = await import("@/lib/ingestion/orangeBook");
const { runPurpleBookIngestion } = await import("@/lib/ingestion/purpleBook");
const { runParagraphIVIngestion } = await import("@/lib/ingestion/paragraphIV");
const { runPtaEnrichment } = await import("@/lib/ingestion/pta");

const ALL_MOCKS = [runOrangeBookIngestion, runPurpleBookIngestion, runParagraphIVIngestion, runPtaEnrichment];

let analyst: TestUser;
let subscriber: TestUser;

beforeEach(async () => {
  await resetDb();
  analyst = await createTestUser({ tier: "analyst" });
  subscriber = await createTestUser({ tier: "subscriber" });
  for (const m of ALL_MOCKS) vi.mocked(m).mockClear();
});

// The orchestrator's concurrency guard is a module-level in-memory Set,
// shared across every test in this file (the module is only loaded once).
// A trigger that's never awaited to completion would leak a "still
// running" entry into the next test — this waits out every invocation
// from the test that just ran (mocks were cleared in beforeEach, so
// .mock.results here is scoped to the current test only) before moving on.
afterEach(async () => {
  for (const m of ALL_MOCKS) {
    for (const result of vi.mocked(m).mock.results) {
      await result.value.catch(() => {});
    }
  }
});

function req(pipeline: string, user?: TestUser) {
  return new NextRequest("http://localhost:3000/api/data/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...(user ? { cookie: user.cookie } : {}) },
    body: JSON.stringify({ pipeline }),
  });
}

describe("POST /api/data/ingest — role gating", () => {
  it("returns 401 with no session", async () => {
    const res = await POST(req("orange_book"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a signed-in subscriber (not just a hidden button — the server itself refuses)", async () => {
    const res = await POST(req("orange_book", subscriber));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 400 for an invalid pipeline value", async () => {
    const res = await POST(req("not_a_real_pipeline", analyst));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/data/ingest — triggering as an Analyst", () => {
  it("returns 202 and creates a real RUNNING IngestionRun row", async () => {
    const res = await POST(req("orange_book", analyst));
    expect(res.status).toBe(202);

    // Wait for the fake pipeline's own (real) DB writes to land — the
    // route itself doesn't await this, by design, so the test awaits the
    // mock's captured return promise directly instead of racing it.
    await vi.mocked(runOrangeBookIngestion).mock.results[0].value;

    const source = await prisma.dataSource.findUnique({ where: { name: ORANGE_BOOK_SOURCE_NAME } });
    expect(source).not.toBeNull();
    const run = await prisma.ingestionRun.findFirst({ where: { sourceId: source!.id }, orderBy: { startedAt: "desc" } });
    expect(run?.status).toBe("SUCCESS"); // the fake resolves synchronously to terminal status once awaited
  });

  it("returns 409 when the same pipeline is triggered again immediately (double-click guard)", async () => {
    // The default fake resolves almost instantly (a couple of local-DB
    // round-trips), which would let the first "run" finish — and release
    // the in-memory guard — before the second request even lands, making
    // this test meaningless. Gate this one invocation on the test's own
    // signal so the first request is still genuinely in flight when the
    // second one checks.
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vi.mocked(runOrangeBookIngestion).mockImplementationOnce(async () => {
      await gate;
      return { status: "SUCCESS" } as Awaited<ReturnType<typeof runOrangeBookIngestion>>;
    });

    const first = await POST(req("orange_book", analyst));
    expect(first.status).toBe(202);

    const second = await POST(req("orange_book", analyst));
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe("CONFLICT");

    // Only one real invocation should have happened — the second request
    // was rejected by the guard before ever calling the pipeline again.
    expect(vi.mocked(runOrangeBookIngestion)).toHaveBeenCalledTimes(1);

    releaseFirst();
    await vi.mocked(runOrangeBookIngestion).mock.results[0].value;
  });

  it("does not block a DIFFERENT pipeline while one is running", async () => {
    const first = await POST(req("orange_book", analyst));
    expect(first.status).toBe(202);

    const second = await POST(req("purple_book", analyst));
    expect(second.status).toBe(202);
  });
});

describe("POST /api/data/ingest — stale RUNNING row recovery", () => {
  it("supersedes a RUNNING row older than the staleness threshold instead of blocking forever", async () => {
    const source = await prisma.dataSource.create({ data: { name: ORANGE_BOOK_SOURCE_NAME } });
    const stale = await prisma.ingestionRun.create({
      data: { sourceId: source.id, status: "RUNNING", startedAt: new Date(Date.now() - 7 * 60 * 60 * 1000) }, // 7h ago, past the 6h threshold
    });

    const res = await POST(req("orange_book", analyst));
    expect(res.status).toBe(202); // proceeds rather than reporting already_running

    const updatedStale = await prisma.ingestionRun.findUniqueOrThrow({ where: { id: stale.id } });
    expect(updatedStale.status).toBe("FAILED");
  });

  it("still blocks on a RUNNING row well within the staleness threshold", async () => {
    const source = await prisma.dataSource.create({ data: { name: ORANGE_BOOK_SOURCE_NAME } });
    await prisma.ingestionRun.create({
      data: { sourceId: source.id, status: "RUNNING", startedAt: new Date(Date.now() - 5 * 60 * 1000) }, // 5 minutes ago
    });

    const res = await POST(req("orange_book", analyst));
    expect(res.status).toBe(409);
  });
});

describe("POST /api/data/ingest — 'all'", () => {
  it("returns 202 and reserves all four pipelines so an individual trigger is blocked mid-chain", async () => {
    const res = await POST(req("all", analyst));
    expect(res.status).toBe(202);

    // Reserved synchronously before the chain's first step even resolves
    // — an individual trigger for a pipeline later in the chain should
    // already see it as busy, not just the first one.
    const blocked = await POST(req("pta", analyst));
    expect(blocked.status).toBe(409);

    // Let the whole sequential chain finish before the test ends, so the
    // in-memory guard is fully released for all four and doesn't leak
    // into the next test (afterEach only awaits invocations that have
    // already happened by the time it runs — pta is last in the chain,
    // so it needs its own explicit wait here).
    await vi.waitFor(() => {
      expect(vi.mocked(runPtaEnrichment).mock.calls.length).toBeGreaterThan(0);
    });
    await vi.mocked(runPtaEnrichment).mock.results[0].value;
  });

  it("returns 409 for 'all' when any individual pipeline is already running", async () => {
    const first = await POST(req("orange_book", analyst));
    expect(first.status).toBe(202);

    const all = await POST(req("all", analyst));
    expect(all.status).toBe(409);
  });
});
