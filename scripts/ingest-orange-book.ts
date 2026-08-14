import "dotenv/config";
import { runOrangeBookIngestion } from "../src/lib/ingestion/orangeBook";

function parseArgs(argv: string[]): { zipPath?: string } {
  const fileFlagIndex = argv.findIndex((a) => a === "--file" || a === "--zip");
  if (fileFlagIndex !== -1 && argv[fileFlagIndex + 1]) {
    return { zipPath: argv[fileFlagIndex + 1] };
  }
  return {};
}

async function main() {
  const { zipPath } = parseArgs(process.argv.slice(2));

  console.log(`[orange-book] starting ingestion${zipPath ? ` from local file ${zipPath}` : " (downloading from FDA)"}...`);

  const summary = await runOrangeBookIngestion({ zipPath });

  console.log("");
  console.log("=== Orange Book ingestion summary ===");
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
  console.log(`  products.txt:     ${summary.rawCounts.products}`);
  console.log(`  patent.txt:       ${summary.rawCounts.patents}`);
  console.log(`  exclusivity.txt:  ${summary.rawCounts.exclusivities}`);
  console.log("");
  console.log("loaded into the database:");
  console.log(`  drugs upserted:          ${summary.drugsUpserted} (skipped ${summary.drugsSkipped})`);
  console.log(`  patents upserted:        ${summary.patentsUpserted} (skipped ${summary.patentsSkipped})`);
  console.log(`  exclusivities upserted:  ${summary.exclusivitiesUpserted} (skipped ${summary.exclusivitiesSkipped})`);
  console.log(`  ingestion records:       ${summary.ingestionRecordsCreated}`);
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
    console.error("[orange-book] fatal error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect();
  });
