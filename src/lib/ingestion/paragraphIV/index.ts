import { prisma } from "@/lib/prisma";
import { fetchParagraphIVPdf } from "./fetchSource";
import { parseParagraphIVPdf } from "./parsePdf";
import { loadParagraphIVData } from "./load";
import type { RowIssue } from "./types";

export const PARAGRAPH_IV_SOURCE_NAME = "FDA Paragraph IV Certifications List";
const PARAGRAPH_IV_INFO_PAGE =
  "https://www.fda.gov/drugs/abbreviated-new-drug-application-anda/patent-certifications-and-suitability-petitions";

export interface IngestionRunSummary {
  runId: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  pdfUrl: string | null;
  rawRowCount: number;
  challengesUpserted: number;
  challengesSkipped: number;
  matchedToAtLeastOneDrug: number;
  unmatchedNoNdaNumber: number;
  unmatchedNdaNotFound: number;
  drugLinksCreated: number;
  ingestionRecordsCreated: number;
  totalIssues: number;
  issueCategories: { reason: string; count: number; examples: RowIssue[] }[];
  errorMessage?: string;
}

const EXAMPLES_PER_CATEGORY = 3;
const MAX_CATEGORIES = 20;

// Same grouping/normalization approach as Orange Book/Purple Book's own
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

export async function runParagraphIVIngestion(opts: { explicitPdfUrl?: string } = {}): Promise<IngestionRunSummary> {
  const source = await prisma.dataSource.upsert({
    where: { name: PARAGRAPH_IV_SOURCE_NAME },
    update: { url: PARAGRAPH_IV_INFO_PAGE },
    create: { name: PARAGRAPH_IV_SOURCE_NAME, url: PARAGRAPH_IV_INFO_PAGE },
  });

  const run = await prisma.ingestionRun.create({ data: { sourceId: source.id, status: "RUNNING" } });
  const startedAt = run.startedAt;

  try {
    const { pdfUrl, pdfBytes } = await fetchParagraphIVPdf({ explicitPdfUrl: opts.explicitPdfUrl });
    const { challenges, issues, rawCount } = await parseParagraphIVPdf(pdfBytes);

    const verifiedAt = new Date();
    const loadResult = await loadParagraphIVData(challenges, { sourceId: source.id, verifiedAt, issues });

    const finishedAt = new Date();
    const status: IngestionRunSummary["status"] = loadResult.challengesSkipped === 0 && issues.length === 0 ? "SUCCESS" : "PARTIAL";

    const summary: IngestionRunSummary = {
      runId: run.id,
      status,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      pdfUrl,
      rawRowCount: rawCount,
      challengesUpserted: loadResult.challengesUpserted,
      challengesSkipped: loadResult.challengesSkipped,
      matchedToAtLeastOneDrug: loadResult.matchedToAtLeastOneDrug,
      unmatchedNoNdaNumber: loadResult.unmatchedNoNdaNumber,
      unmatchedNdaNotFound: loadResult.unmatchedNdaNotFound,
      drugLinksCreated: loadResult.drugLinksCreated,
      ingestionRecordsCreated: loadResult.ingestionRecordsCreated,
      totalIssues: issues.length,
      issueCategories: categorizeIssues(issues),
    };

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt,
        // drugsUpserted is the generically-named "primary entity count"
        // column shared across pipelines (same reuse as Purple Book's
        // productsUpserted) — GenericChallenge rows belong here.
        drugsUpserted: loadResult.challengesUpserted,
        patentsUpserted: 0,
        exclusivitiesUpserted: 0,
        rowsSkipped: loadResult.challengesSkipped,
        summary: JSON.parse(JSON.stringify(summary)),
      },
    });

    return summary;
  } catch (error) {
    const finishedAt = new Date();
    const errorMessage = error instanceof Error ? error.message : String(error);

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt, summary: { errorMessage } },
    });

    return {
      runId: run.id,
      status: "FAILED",
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      pdfUrl: null,
      rawRowCount: 0,
      challengesUpserted: 0,
      challengesSkipped: 0,
      matchedToAtLeastOneDrug: 0,
      unmatchedNoNdaNumber: 0,
      unmatchedNdaNotFound: 0,
      drugLinksCreated: 0,
      ingestionRecordsCreated: 0,
      totalIssues: 0,
      issueCategories: [],
      errorMessage,
    };
  }
}
