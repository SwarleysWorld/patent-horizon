import "dotenv/config";
import { runSettlementsIngestion } from "../src/lib/ingestion/settlements";

function parseArgs(argv: string[]): { limit?: number; brandNames?: string[] } {
  const limitFlagIndex = argv.findIndex((a) => a === "--limit");
  const limitRaw = limitFlagIndex !== -1 ? argv[limitFlagIndex + 1] : undefined;
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  const brandIndex = argv.indexOf("--brand");
  const brandNames = brandIndex !== -1 && argv[brandIndex + 1] ? argv[brandIndex + 1].split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  return { limit: Number.isFinite(limit) ? limit : undefined, brandNames };
}

async function main() {
  const { limit, brandNames } = parseArgs(process.argv.slice(2));

  console.log(
    `[settlements] starting ingestion${brandNames ? ` for ${brandNames.length} explicit brand name(s): ${brandNames.join(", ")}` : ` (batch of ${limit ?? 15} brands, oldest-checked-first)`}...`,
  );
  console.log("[settlements] Searches SEC EDGAR's full-text search API by brand name — see README \"Data ingestion: Settlement Disclosures\".");

  const summary = await runSettlementsIngestion({ limit, brandNames });

  console.log("");
  console.log("=== Settlements ingestion summary ===");
  console.log(`run id:       ${summary.runId}`);
  console.log(`status:       ${summary.status}`);
  console.log(`started:      ${summary.startedAt.toISOString()}`);
  console.log(`finished:     ${summary.finishedAt.toISOString()}`);
  console.log(`duration:     ${(summary.durationMs / 1000).toFixed(1)}s`);
  console.log("");
  console.log(`brands checked:       ${summary.brandsChecked}`);
  console.log(`filings scanned:      ${summary.filingsScanned}`);
  console.log(`settlements extracted: ${summary.settlementsExtracted}`);
  console.log(`drug links created:   ${summary.drugLinksCreated}`);

  console.log("");
  console.log(`issues logged: ${summary.totalIssues}`);
  if (summary.issueCategories.length > 0) {
    console.log(`(grouped into ${summary.issueCategories.length} categories, most common first)`);
    for (const cat of summary.issueCategories) {
      console.log(`  x${cat.count}  ${cat.reason}`);
      for (const example of cat.examples) {
        console.log(`         e.g. raw="${String(example.raw).slice(0, 80)}"`);
      }
    }
  }

  if (summary.status === "FAILED") {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[settlements] fatal error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect();
  });
