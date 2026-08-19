import { spawn } from "node:child_process";

// One command for "get the freshest possible data" — re-downloads both FDA
// sources and reclassifies everything, in the right order. Deliberately
// does NOT include PTA enrichment: that's a separate, hours-long process
// against a strict external rate limit (see `npm run enrich:pta`), not
// something a routine data refresh should silently block on.

interface Step {
  label: string;
  npmScript: string;
}

const STEPS: Step[] = [
  { label: "FDA Orange Book (small-molecule drugs)", npmScript: "ingest:orange-book" },
  { label: "FDA Purple Book (biologics)", npmScript: "ingest:purple-book" },
  { label: "FDA Paragraph IV Certifications List (generic challenges)", npmScript: "ingest:paragraph-iv" },
  { label: "Classification backfill (modality / drug class)", npmScript: "classify:drugs" },
];

function runStep(npmScript: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", npmScript], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const startedAt = Date.now();
  console.log("=== Refreshing all data ===");
  console.log(`${STEPS.length} steps: ${STEPS.map((s) => s.label).join(" -> ")}\n`);

  for (const [i, step] of STEPS.entries()) {
    console.log(`\n--- [${i + 1}/${STEPS.length}] ${step.label} (npm run ${step.npmScript}) ---\n`);
    const code = await runStep(step.npmScript);
    // Ingestion pipelines exit 1 only on a genuine failure (a PARTIAL run —
    // rows skipped/logged, the expected steady state — exits 0). Stop the
    // whole sequence rather than pressing on with a broken prior step.
    if (code !== 0) {
      console.error(`\n[refresh-data] "${step.npmScript}" exited with code ${code} — stopping here.`);
      process.exitCode = 1;
      return;
    }
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n=== Refresh complete in ${seconds}s ===`);
  console.log("Next, if you want corrected patent-term dates: npm run enrich:pta");
  console.log("Check progress any time at /data in the running app.");
}

main().catch((error) => {
  console.error("[refresh-data] fatal error:", error);
  process.exitCode = 1;
});
