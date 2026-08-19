import { prisma } from "@/lib/prisma";
import { ORANGE_BOOK_SOURCE_NAME } from "./orangeBook";
import { PURPLE_BOOK_SOURCE_NAME } from "./purpleBook";
import { PTA_SOURCE_NAME } from "./pta/enrich";

// Powers the /data operator page — a single place to answer "is the data
// fresh, and is enrichment actually progressing" without anyone having to
// run a query by hand or ask an agent to check for them.

export interface DataSourceStatus {
  name: string;
  url: string | null;
  lastRun: {
    id: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    drugsUpserted: number;
    patentsUpserted: number;
    exclusivitiesUpserted: number;
    rowsSkipped: number;
  } | null;
}

export interface EnrichmentProgress {
  totalPatents: number;
  enrichedPatents: number;
  orangeBookTotal: number;
  orangeBookEnriched: number;
  purpleBookTotal: number;
  purpleBookEnriched: number;
  // A run isn't one long IngestionRun row the way Orange/Purple Book
  // ingestion is — PTA enrichment writes one IngestionRecord per patent as
  // it goes, so "is it running right now" is inferred from recent write
  // activity rather than read off a single row's status.
  recentActivity: boolean;
  lastActivityAt: Date | null;
}

const ACTIVE_WINDOW_MS = 2 * 60 * 1000; // no write in the last 2 minutes -> treat as idle, not running

async function getSourceStatus(name: string): Promise<DataSourceStatus> {
  const source = await prisma.dataSource.findUnique({
    where: { name },
    include: { ingestionRuns: { orderBy: { startedAt: "desc" }, take: 1 } },
  });
  if (!source) return { name, url: null, lastRun: null };

  const run = source.ingestionRuns[0];
  return {
    name: source.name,
    url: source.url,
    lastRun: run
      ? {
          id: run.id,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          drugsUpserted: run.drugsUpserted,
          patentsUpserted: run.patentsUpserted,
          exclusivitiesUpserted: run.exclusivitiesUpserted,
          rowsSkipped: run.rowsSkipped,
        }
      : null,
  };
}

async function getEnrichmentProgress(): Promise<EnrichmentProgress> {
  const [totals, lastRecord] = await Promise.all([
    prisma.$queryRaw<
      { source: "orange_book" | "purple_book"; total: bigint; enriched: bigint }[]
    >`
      SELECT
        CASE WHEN "drugId" IS NOT NULL THEN 'orange_book' ELSE 'purple_book' END AS source,
        count(*) AS total,
        count(*) FILTER (WHERE "filingDate" IS NOT NULL) AS enriched
      FROM "Patent"
      GROUP BY 1
    `,
    prisma.ingestionRecord.findFirst({
      where: { source: { name: PTA_SOURCE_NAME } },
      orderBy: { createdAt: "desc" },
      // NOT verifiedAt: a single `npm run enrich:pta` invocation (no
      // --limit) stamps every record it writes with the SAME verifiedAt —
      // set once when the run starts, deliberately, so every record from
      // one logical run shares one "as of" timestamp for provenance. That
      // makes verifiedAt useless for "is this actively running right now"
      // during a run that can take hours: it would read as frozen at the
      // start time the whole way through, even with real writes landing
      // every ~350ms. createdAt is a DB-level `@default(now())`, set at
      // the actual moment each row is inserted — the real per-write clock.
      select: { createdAt: true },
    }),
  ]);

  const orangeBook = totals.find((t) => t.source === "orange_book");
  const purpleBook = totals.find((t) => t.source === "purple_book");
  const orangeBookTotal = Number(orangeBook?.total ?? 0);
  const orangeBookEnriched = Number(orangeBook?.enriched ?? 0);
  const purpleBookTotal = Number(purpleBook?.total ?? 0);
  const purpleBookEnriched = Number(purpleBook?.enriched ?? 0);

  const lastActivityAt = lastRecord?.createdAt ?? null;
  const recentActivity = lastActivityAt != null && Date.now() - lastActivityAt.getTime() < ACTIVE_WINDOW_MS;

  return {
    totalPatents: orangeBookTotal + purpleBookTotal,
    enrichedPatents: orangeBookEnriched + purpleBookEnriched,
    orangeBookTotal,
    orangeBookEnriched,
    purpleBookTotal,
    purpleBookEnriched,
    recentActivity,
    lastActivityAt,
  };
}

export interface IngestionStatus {
  sources: DataSourceStatus[];
  enrichment: EnrichmentProgress;
}

export async function getIngestionStatus(): Promise<IngestionStatus> {
  const [orangeBook, purpleBook, pta, enrichment] = await Promise.all([
    getSourceStatus(ORANGE_BOOK_SOURCE_NAME),
    getSourceStatus(PURPLE_BOOK_SOURCE_NAME),
    getSourceStatus(PTA_SOURCE_NAME),
    getEnrichmentProgress(),
  ]);
  return { sources: [orangeBook, purpleBook, pta], enrichment };
}
