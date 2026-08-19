import "dotenv/config";
import { runParagraphIVIngestion } from "../src/lib/ingestion/paragraphIV";

function parseArgs(argv: string[]): { url?: string } {
  const urlFlagIndex = argv.findIndex((a) => a === "--url");
  const url = urlFlagIndex !== -1 && argv[urlFlagIndex + 1] ? argv[urlFlagIndex + 1] : undefined;
  return { url };
}

async function main() {
  const { url } = parseArgs(process.argv.slice(2));

  console.log(
    `[paragraph-iv] starting ingestion${url ? ` from ${url}` : " (scraping FDA's page for the current PDF link)"}...`,
  );

  const summary = await runParagraphIVIngestion({ explicitPdfUrl: url });

  console.log("");
  console.log("=== Paragraph IV ingestion summary ===");
  console.log(`run id:       ${summary.runId}`);
  console.log(`status:       ${summary.status}`);
  console.log(`started:      ${summary.startedAt.toISOString()}`);
  console.log(`finished:     ${summary.finishedAt.toISOString()}`);
  console.log(`duration:     ${(summary.durationMs / 1000).toFixed(1)}s`);

  if (summary.status === "FAILED") {
    console.error(`error:        ${summary.errorMessage}`);
    process.exitCode = 1;
    return;
  }

  console.log(`source PDF:   ${summary.pdfUrl}`);
  console.log("");
  console.log(`raw rows parsed from PDF: ${summary.rawRowCount}`);
  console.log("");
  console.log("loaded into the database:");
  console.log(`  challenges upserted: ${summary.challengesUpserted} (skipped ${summary.challengesSkipped})`);
  console.log(`  drug links created:  ${summary.drugLinksCreated}`);
  console.log("");
  console.log("product-matching results (see README for the strategy):");
  console.log(`  matched to >=1 Drug:            ${summary.matchedToAtLeastOneDrug}`);
  console.log(`  unmatched — no NDA# in source:  ${summary.unmatchedNoNdaNumber}`);
  console.log(`  unmatched — NDA# not found:     ${summary.unmatchedNdaNotFound}`);
  console.log(`  ingestion records:              ${summary.ingestionRecordsCreated}`);

  console.log("");
  console.log(`row-level issues logged: ${summary.totalIssues}`);

  if (summary.issueCategories.length > 0) {
    console.log(`(grouped into ${summary.issueCategories.length} categories, most common first)`);
    for (const cat of summary.issueCategories) {
      console.log(`  x${cat.count}  ${cat.reason}`);
      for (const example of cat.examples) {
        console.log(`         e.g. [${example.file}:${example.line}] raw="${example.raw.slice(0, 80)}"`);
      }
    }
  }

  if (summary.status === "PARTIAL") {
    process.exitCode = 0; // rows were skipped/logged, but this is expected steady-state behavior, not a failure
  }
}

main()
  .catch((error) => {
    console.error("[paragraph-iv] fatal error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect();
  });
