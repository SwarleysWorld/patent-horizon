import { prisma } from "@/lib/prisma";
import { parseProductsCsv } from "./parseProducts";
import { fetchPatentListHtml, parsePatentListHtml, PATENT_LIST_URL } from "./parsePatentList";
import { loadPurpleBookData } from "./load";
import type { RowIssue } from "./types";
import { throwIfCancelled, abortSignalFor, statusForError, isCancelRequested, RunCancelledError } from "../cancellation";

export const PURPLE_BOOK_SOURCE_NAME = "FDA Purple Book";
const PURPLE_BOOK_INFO_PAGE = "https://purplebooksearch.fda.gov/downloads";

// Purple Book's WAF blocks requests with no browser-like User-Agent —
// confirmed directly (see parsePatentList.ts's longer note). Applies to
// the product CSV download too, not just the patent-list HTML page.
const BROWSER_LIKE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "text/csv,*/*",
};

// FDA publishes one file per month, named with the (unabbreviated,
// title-case) month name — confirmed directly that as of this writing the
// current calendar month's file isn't published yet (only through the
// PRIOR month), so guessing the current month as the default and just
// failing on a 404 isn't good enough; see fetchProductsCsv's fallback.
function csvUrlForMonth(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return `https://www.accessdata.fda.gov/drugsatfda_docs/PurpleBook/${year}/purplebook-search-${month}-data-download.csv`;
}

function previousMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
}

async function fetchUrl(url: string, signal: AbortSignal): Promise<{ ok: true; text: string } | { ok: false; status: number }> {
  const res = await fetch(url, { headers: BROWSER_LIKE_HEADERS, signal });
  if (!res.ok) return { ok: false, status: res.status };
  const text = await res.text();
  if (text.includes("FDA Apology") || text.includes("abuse-detection-apology")) {
    throw new Error("Purple Book product CSV request was blocked (WAF apology page) — try again, or check if the User-Agent needs updating");
  }
  return { ok: true, text };
}

// No explicit URL given: try the current month, and — since the current
// month's file routinely isn't published yet — fall back to the prior
// month on a 404 rather than hard-failing. Only one fallback step: if the
// prior month is ALSO missing, something more unusual is going on and
// that's worth surfacing as a real error rather than guessing further back.
async function fetchProductsCsv(explicitUrl: string | undefined, signal: AbortSignal): Promise<string> {
  if (explicitUrl) {
    const result = await fetchUrl(explicitUrl, signal);
    if (!result.ok) throw new Error(`failed to download Purple Book product data: HTTP ${result.status}`);
    return result.text;
  }

  const now = new Date();
  const currentMonthUrl = csvUrlForMonth(now);
  const current = await fetchUrl(currentMonthUrl, signal);
  if (current.ok) return current.text;
  if (current.status !== 404) {
    throw new Error(`failed to download Purple Book product data: HTTP ${current.status} (${currentMonthUrl})`);
  }

  const priorMonthUrl = csvUrlForMonth(previousMonth(now));
  const prior = await fetchUrl(priorMonthUrl, signal);
  if (prior.ok) return prior.text;
  throw new Error(
    `failed to download Purple Book product data: neither the current month (${currentMonthUrl}, HTTP 404) nor the prior month (${priorMonthUrl}, HTTP ${prior.status}) is available — pass --url explicitly`,
  );
}

export interface IngestionRunSummary {
  runId: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "CANCELLED";
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  rawCounts: { products: number; patents: number };
  productsUpserted: number;
  patentsUpserted: number;
  exclusivitiesUpserted: number;
  productsSkipped: number;
  patentsSkipped: number;
  exclusivitiesSkipped: number;
  referenceProductsResolved: number;
  referenceProductsUnresolved: number;
  ingestionRecordsCreated: number;
  totalIssues: number;
  issueCategories: { reason: string; count: number; examples: RowIssue[] }[];
  patentListFetchFailed?: string; // set when the (separate, more fragile) patent-list scrape failed but product ingestion still succeeded
  errorMessage?: string;
}

const EXAMPLES_PER_CATEGORY = 3;
const MAX_CATEGORIES = 20;

// Same grouping/normalization approach as Orange Book's own
// categorizeIssues — one noisy-but-benign category shouldn't crowd rarer,
// more actionable ones out of a flat top-N slice.
function categorizeIssues(issues: RowIssue[]): IngestionRunSummary["issueCategories"] {
  const byCategory = new Map<string, RowIssue[]>();
  for (const issue of issues) {
    const category = issue.reason.replace(/"[^"]*"/g, '"…"');
    const bucket = byCategory.get(category) ?? [];
    bucket.push(issue);
    byCategory.set(category, bucket);
  }
  return [...byCategory.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_CATEGORIES)
    .map(([reason, examples]) => ({ reason, count: examples.length, examples: examples.slice(0, EXAMPLES_PER_CATEGORY) }));
}

export async function runPurpleBookIngestion(
  opts: { csvUrl?: string; csvContent?: string; skipPatentList?: boolean } = {},
): Promise<IngestionRunSummary> {
  const source = await prisma.dataSource.upsert({
    where: { name: PURPLE_BOOK_SOURCE_NAME },
    update: { url: PURPLE_BOOK_INFO_PAGE },
    create: { name: PURPLE_BOOK_SOURCE_NAME, url: PURPLE_BOOK_INFO_PAGE },
  });

  const run = await prisma.ingestionRun.create({ data: { sourceId: source.id, status: "RUNNING" } });
  const startedAt = run.startedAt;
  // One AbortController for the whole run, not one per phase: its signal
  // both aborts an in-flight fetch() and is checked (cheaply, no DB round
  // trip per item) by mapWithConcurrency inside loadPurpleBookData — the
  // bulk DB-upsert phase is the slowest part of a run by far, and a Stop
  // click landing during it needs a checkpoint there too, not just
  // between phases.
  const ac = abortSignalFor(run.id);

  try {
    await throwIfCancelled(run.id);
    const csvContent = opts.csvContent ?? (await fetchProductsCsv(opts.csvUrl, ac.signal));
    await throwIfCancelled(run.id);
    const { products, exclusivities, rawCount: productsRaw, issues } = parseProductsCsv(csvContent);

    // The patent-list scrape is separate and materially more fragile (HTML
    // structure, not a real data file — see parsePatentList.ts) than the
    // product CSV. A failure here should never take down the far more
    // valuable product ingestion, so it's isolated in its own try/catch
    // and degrades to "0 patents this run" with a clearly surfaced reason,
    // rather than failing the whole run. A stop request is deliberately
    // NOT swallowed the same way — it's re-thrown so it still cancels the
    // whole run instead of quietly turning into "patent list unavailable".
    let patents: Awaited<ReturnType<typeof parsePatentListHtml>>["patents"] = [];
    let patentsRaw = 0;
    let patentListFetchFailed: string | undefined;
    if (!opts.skipPatentList) {
      try {
        const html = await fetchPatentListHtml(PATENT_LIST_URL, ac.signal);
        const parsed = parsePatentListHtml(html);
        patents = parsed.patents;
        patentsRaw = parsed.rawCount;
        issues.push(...parsed.issues);
      } catch (error) {
        // A stopped fetch surfaces as the signal's own AbortError, not a
        // RunCancelledError — check the flag directly rather than the
        // error's type, so either shape of "this was a stop, not a real
        // failure" re-throws instead of being swallowed as
        // patentListFetchFailed.
        if (error instanceof RunCancelledError || (await isCancelRequested(run.id))) throw new RunCancelledError();
        patentListFetchFailed = error instanceof Error ? error.message : String(error);
      }
    }

    await throwIfCancelled(run.id);
    const verifiedAt = new Date();
    const loadResult = await loadPurpleBookData(
      { products, exclusivities, patents },
      { sourceId: source.id, verifiedAt, issues, signal: ac.signal },
    );

    const finishedAt = new Date();
    const totalSkipped = loadResult.productsSkipped + loadResult.patentsSkipped + loadResult.exclusivitiesSkipped;
    const status: IngestionRunSummary["status"] =
      totalSkipped === 0 && issues.length === 0 && !patentListFetchFailed ? "SUCCESS" : "PARTIAL";

    const summary: IngestionRunSummary = {
      runId: run.id,
      status,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      rawCounts: { products: productsRaw, patents: patentsRaw },
      productsUpserted: loadResult.productsUpserted,
      patentsUpserted: loadResult.patentsUpserted,
      exclusivitiesUpserted: loadResult.exclusivitiesUpserted,
      productsSkipped: loadResult.productsSkipped,
      patentsSkipped: loadResult.patentsSkipped,
      exclusivitiesSkipped: loadResult.exclusivitiesSkipped,
      referenceProductsResolved: loadResult.referenceProductsResolved,
      referenceProductsUnresolved: loadResult.referenceProductsUnresolved,
      ingestionRecordsCreated: loadResult.ingestionRecordsCreated,
      totalIssues: issues.length,
      issueCategories: categorizeIssues(issues),
      patentListFetchFailed,
    };

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt,
        // IngestionRun.drugsUpserted is a generically-named "primary
        // entity count" column shared across pipelines (same reuse as
        // patentsUpserted/exclusivitiesUpserted below) — biologic products
        // belong here, not a hardcoded 0. Previously zeroed out, which
        // made the /data monitoring page show "Products: 0" for a run that
        // had actually loaded thousands.
        drugsUpserted: loadResult.productsUpserted,
        patentsUpserted: loadResult.patentsUpserted,
        exclusivitiesUpserted: loadResult.exclusivitiesUpserted,
        rowsSkipped: totalSkipped,
        summary: JSON.parse(JSON.stringify(summary)),
      },
    });

    return summary;
  } catch (error) {
    const finishedAt = new Date();
    const status = statusForError(error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    await prisma.ingestionRun.update({
      where: { id: run.id },
      // Cancellation isn't an error — leave summary.errorMessage unset so
      // SourceCard's dedicated CANCELLED message shows instead of the
      // FAILED-styled error box.
      data: { status, finishedAt, summary: status === "CANCELLED" ? {} : { errorMessage } },
    });

    return {
      runId: run.id,
      status,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      rawCounts: { products: 0, patents: 0 },
      productsUpserted: 0,
      patentsUpserted: 0,
      exclusivitiesUpserted: 0,
      productsSkipped: 0,
      patentsSkipped: 0,
      exclusivitiesSkipped: 0,
      referenceProductsResolved: 0,
      referenceProductsUnresolved: 0,
      ingestionRecordsCreated: 0,
      totalIssues: 0,
      issueCategories: [],
      errorMessage,
    };
  } finally {
    ac.stop();
  }
}

export { PATENT_LIST_URL };
