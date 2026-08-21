import AdmZip from "adm-zip";
import { prisma } from "@/lib/prisma";
import { parseOrangeBookFiles } from "./parse";
import { loadOrangeBookData } from "./load";
import type { RowIssue } from "./types";
import { throwIfCancelled, abortSignalFor, statusForError } from "../cancellation";

export const ORANGE_BOOK_SOURCE_NAME = "FDA Orange Book";
export const ORANGE_BOOK_DEFAULT_URL = "https://www.fda.gov/media/76860/download?attachment";
const ORANGE_BOOK_INFO_PAGE = "https://www.fda.gov/drugs/drug-approvals-and-databases/orange-book-data-files";

export interface IngestionRunSummary {
  runId: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "CANCELLED";
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  rawCounts: { products: number; patents: number; exclusivities: number };
  drugsUpserted: number;
  patentsUpserted: number;
  exclusivitiesUpserted: number;
  drugsSkipped: number;
  patentsSkipped: number;
  exclusivitiesSkipped: number;
  ingestionRecordsCreated: number;
  totalIssues: number;
  issueCategories: { reason: string; count: number; examples: RowIssue[] }[];
  errorMessage?: string;
}

const EXAMPLES_PER_CATEGORY = 3;
const MAX_CATEGORIES = 20;

// Groups issues by a normalized reason (quoted values blanked out) so one
// noisy-but-benign category — e.g. 1400+ "*PED row with no plain base
// row" warnings — can't crowd out rarer, more actionable ones out of a
// flat top-N slice.
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
    .map(([reason, examples]) => ({
      reason,
      count: examples.length,
      examples: examples.slice(0, EXAMPLES_PER_CATEGORY),
    }));
}

async function fetchZipBuffer(url: string, signal: AbortSignal): Promise<Buffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`failed to download Orange Book zip: HTTP ${res.status} ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function extractFiles(zipBuffer: Buffer): { products: string; patent: string; exclusivity: string } {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  function readEntry(name: string): string {
    const entry = entries.find((e) => e.entryName.toLowerCase() === name);
    if (!entry) {
      throw new Error(
        `expected "${name}" in the Orange Book zip but found: ${entries.map((e) => e.entryName).join(", ")}`,
      );
    }
    return zip.readAsText(entry);
  }

  return {
    products: readEntry("products.txt"),
    patent: readEntry("patent.txt"),
    exclusivity: readEntry("exclusivity.txt"),
  };
}

export async function runOrangeBookIngestion(
  opts: { zipPath?: string; sourceUrl?: string } = {},
): Promise<IngestionRunSummary> {
  const sourceUrl = opts.sourceUrl ?? ORANGE_BOOK_DEFAULT_URL;

  const source = await prisma.dataSource.upsert({
    where: { name: ORANGE_BOOK_SOURCE_NAME },
    update: { url: ORANGE_BOOK_INFO_PAGE },
    create: { name: ORANGE_BOOK_SOURCE_NAME, url: ORANGE_BOOK_INFO_PAGE },
  });

  const run = await prisma.ingestionRun.create({
    data: { sourceId: source.id, status: "RUNNING" },
  });

  const startedAt = run.startedAt;
  // One AbortController for the whole run, not one per phase: its signal
  // both aborts an in-flight fetch() and is checked (cheaply, no DB round
  // trip per item) by mapWithConcurrency inside loadOrangeBookData — the
  // bulk DB-upsert phase is the slowest part of a run by far, and a
  // Stop click landing during it needs a checkpoint there too, not just
  // between phases.
  const ac = abortSignalFor(run.id);

  try {
    await throwIfCancelled(run.id);
    let zipBuffer: Buffer;
    if (opts.zipPath) {
      zipBuffer = await (await import("node:fs/promises")).readFile(opts.zipPath);
    } else {
      zipBuffer = await fetchZipBuffer(sourceUrl, ac.signal);
    }

    await throwIfCancelled(run.id);
    const files = extractFiles(zipBuffer);
    const parsed = parseOrangeBookFiles(files);

    await throwIfCancelled(run.id);
    const verifiedAt = new Date();
    const loadResult = await loadOrangeBookData(parsed, {
      sourceId: source.id,
      verifiedAt,
      issues: parsed.issues,
      signal: ac.signal,
    });

    const finishedAt = new Date();
    const totalSkipped =
      loadResult.drugsSkipped + loadResult.patentsSkipped + loadResult.exclusivitiesSkipped;
    const status: IngestionRunSummary["status"] =
      totalSkipped === 0 && parsed.issues.length === 0 ? "SUCCESS" : "PARTIAL";

    const summary: IngestionRunSummary = {
      runId: run.id,
      status,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      rawCounts: parsed.rawCounts,
      drugsUpserted: loadResult.drugsUpserted,
      patentsUpserted: loadResult.patentsUpserted,
      exclusivitiesUpserted: loadResult.exclusivitiesUpserted,
      drugsSkipped: loadResult.drugsSkipped,
      patentsSkipped: loadResult.patentsSkipped,
      exclusivitiesSkipped: loadResult.exclusivitiesSkipped,
      ingestionRecordsCreated: loadResult.ingestionRecordsCreated,
      totalIssues: parsed.issues.length,
      issueCategories: categorizeIssues(parsed.issues),
    };

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt,
        drugsUpserted: loadResult.drugsUpserted,
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
      data: {
        status,
        finishedAt,
        // Cancellation isn't an error — leave summary.errorMessage unset
        // so SourceCard's dedicated CANCELLED message shows instead of the
        // FAILED-styled error box.
        summary: status === "CANCELLED" ? {} : { errorMessage },
      },
    });

    return {
      runId: run.id,
      status,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      rawCounts: { products: 0, patents: 0, exclusivities: 0 },
      drugsUpserted: 0,
      patentsUpserted: 0,
      exclusivitiesUpserted: 0,
      drugsSkipped: 0,
      patentsSkipped: 0,
      exclusivitiesSkipped: 0,
      ingestionRecordsCreated: 0,
      totalIssues: 0,
      issueCategories: [],
      errorMessage,
    };
  } finally {
    ac.stop();
  }
}
