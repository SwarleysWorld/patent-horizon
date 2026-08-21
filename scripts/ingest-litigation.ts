import "dotenv/config";
import { runLitigationIngestion } from "../src/lib/ingestion/litigation";

function parseArgs(argv: string[]): { limit?: number; companyIds?: string[] } {
  const limitFlagIndex = argv.findIndex((a) => a === "--limit");
  const limitRaw = limitFlagIndex !== -1 ? argv[limitFlagIndex + 1] : undefined;
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  const companyIds: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--company-id" && argv[i + 1]) companyIds.push(argv[i + 1]);
  }

  return { limit: Number.isFinite(limit) ? limit : undefined, companyIds: companyIds.length > 0 ? companyIds : undefined };
}

async function main() {
  const { limit, companyIds } = parseArgs(process.argv.slice(2));

  console.log(
    `[litigation] starting ingestion${companyIds ? ` for ${companyIds.length} explicit company id(s)` : ` (batch of ${limit ?? 25} companies, oldest-checked-first)`}...`,
  );
  console.log("[litigation] CourtListener's free tier is rate-limited to 5 req/min, 125/day — this run is bounded accordingly, not a full sweep.");

  const summary = await runLitigationIngestion({ limit, companyIds });

  console.log("");
  console.log("=== Litigation ingestion summary ===");
  console.log(`run id:       ${summary.runId}`);
  console.log(`status:       ${summary.status}`);
  console.log(`started:      ${summary.startedAt.toISOString()}`);
  console.log(`finished:     ${summary.finishedAt.toISOString()}`);
  console.log(`duration:     ${(summary.durationMs / 1000).toFixed(1)}s`);

  if (summary.status === "FAILED" && summary.companiesChecked === 0) {
    console.error(`error:        ${summary.errorMessage}`);
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(`companies checked: ${summary.companiesChecked}`);
  console.log(`cases touched:     ${summary.casesTouched}`);
  console.log(`dockets upserted:  ${summary.docketsUpserted}`);
  console.log(`ingestion records: ${summary.ingestionRecordsCreated}`);
  console.log("");
  console.log("match confidence breakdown (per hit processed, not per case):");
  console.log(`  HIGH:   ${summary.confidenceCounts.HIGH}`);
  console.log(`  MEDIUM: ${summary.confidenceCounts.MEDIUM}`);
  console.log(`  LOW:    ${summary.confidenceCounts.LOW}`);

  if (summary.abortedOnAuthError) {
    console.error("");
    console.error(`aborted early: ${summary.errorMessage}`);
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(`issues logged: ${summary.totalIssues}`);
  if (summary.issueCategories.length > 0) {
    console.log(`(grouped into ${summary.issueCategories.length} categories, most common first)`);
    for (const cat of summary.issueCategories) {
      console.log(`  x${cat.count}  ${cat.reason}`);
      for (const example of cat.examples) {
        console.log(`         e.g. raw="${example.raw.slice(0, 80)}"`);
      }
    }
  }
}

main()
  .catch((error) => {
    console.error("[litigation] fatal error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect();
  });
