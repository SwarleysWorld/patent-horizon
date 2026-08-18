import "dotenv/config";
import { runPurpleBookIngestion } from "../src/lib/ingestion/purpleBook";

function parseArgs(argv: string[]): { csvUrl?: string; skipPatentList?: boolean } {
  const urlFlagIndex = argv.findIndex((a) => a === "--url");
  const csvUrl = urlFlagIndex !== -1 && argv[urlFlagIndex + 1] ? argv[urlFlagIndex + 1] : undefined;
  return { csvUrl, skipPatentList: argv.includes("--skip-patent-list") };
}

async function main() {
  const { csvUrl, skipPatentList } = parseArgs(process.argv.slice(2));

  console.log(
    `[purple-book] starting ingestion${csvUrl ? ` from ${csvUrl}` : " (downloading current month's product data from FDA)"}${skipPatentList ? " — patent-list scrape skipped" : ""}...`,
  );

  const summary = await runPurpleBookIngestion({ csvUrl, skipPatentList });

  console.log("");
  console.log("=== Purple Book ingestion summary ===");
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

  console.log("");
  console.log("raw source rows:");
  console.log(`  product CSV (full snapshot section): ${summary.rawCounts.products}`);
  console.log(`  patent-list.html rows:               ${summary.rawCounts.patents}`);
  console.log("");
  console.log("loaded into the database:");
  console.log(`  biologic products upserted:  ${summary.productsUpserted} (skipped ${summary.productsSkipped})`);
  console.log(`  patents upserted:            ${summary.patentsUpserted} (skipped ${summary.patentsSkipped})`);
  console.log(`  exclusivities upserted:      ${summary.exclusivitiesUpserted} (skipped ${summary.exclusivitiesSkipped})`);
  console.log(`  reference products resolved: ${summary.referenceProductsResolved} (unresolved ${summary.referenceProductsUnresolved})`);
  console.log(`  ingestion records:           ${summary.ingestionRecordsCreated}`);

  if (summary.patentListFetchFailed) {
    console.log("");
    console.log(`patent-list fetch FAILED (product ingestion still succeeded): ${summary.patentListFetchFailed}`);
  }

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
    console.error("[purple-book] fatal error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect();
  });
