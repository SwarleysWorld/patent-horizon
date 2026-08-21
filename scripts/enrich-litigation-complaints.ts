import "dotenv/config";
import { runComplaintEnrichment } from "../src/lib/ingestion/litigation";
import { prisma } from "../src/lib/prisma";

function parseArgs(argv: string[]): { limit?: number; caseIds?: string[]; drugIds?: string[] } {
  const limitFlagIndex = argv.indexOf("--limit");
  const limitRaw = limitFlagIndex !== -1 ? argv[limitFlagIndex + 1] : undefined;
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  const caseIndex = argv.indexOf("--case-id");
  const caseIds = caseIndex !== -1 && argv[caseIndex + 1] ? argv[caseIndex + 1].split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  const drugIndex = argv.indexOf("--drug-id");
  const drugIds = drugIndex !== -1 && argv[drugIndex + 1] ? argv[drugIndex + 1].split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  return { limit: Number.isFinite(limit) ? limit : undefined, caseIds, drugIds };
}

async function main() {
  const { limit, caseIds, drugIds } = parseArgs(process.argv.slice(2));

  console.log(
    `[litigation-complaints] starting${caseIds ? ` (${caseIds.length} explicit case id(s))` : drugIds ? ` (cases linked to ${drugIds.length} explicit drug id(s))` : ` (batch of ${limit ?? 25} cases, oldest-checked-first)`}...`,
  );
  console.log("[litigation-complaints] Fetches each case's Document 1 from CourtListener (free RECAP archive only — no PACER purchase). Shares the litigation pipeline's rate limit (5 req/min).");

  const summary = await runComplaintEnrichment({ limit, caseIds, drugIds });

  console.log("");
  console.log("=== Complaint enrichment summary ===");
  console.log(`run id:    ${summary.runId}`);
  console.log(`status:    ${summary.status}`);
  console.log(`duration:  ${(summary.durationMs / 1000).toFixed(1)}s`);
  console.log("");
  console.log(`cases checked:              ${summary.casesChecked}`);
  console.log(`  matched via patent number: ${summary.matchedViaPatent}`);
  console.log(`  matched via brand name:    ${summary.matchedViaBrand}`);
  console.log(`  complaint found, no match: ${summary.complaintParsedNoMatch}`);
  console.log(`  complaint not free:        ${summary.noFreeComplaint}`);
  console.log(`  not yet in RECAP at all:   ${summary.notScraped}`);
  console.log(`  errors:                    ${summary.errors}`);

  if (summary.abortedOnAuthError) {
    console.error("");
    console.error("aborted early: auth error — check COURTLISTENER_API_KEY");
    process.exitCode = 1;
    return;
  }

  const upgraded = summary.results.filter((r) => r.outcome.kind === "matched_via_patent" || r.outcome.kind === "matched_via_brand");
  if (upgraded.length > 0) {
    console.log("");
    console.log("--- upgraded to HIGH confidence ---");
    for (const { caseId, outcome } of upgraded) {
      if (outcome.kind === "matched_via_patent") console.log(`  ${caseId}  patent ${outcome.patentNumber} -> drug(s) ${outcome.drugIds.join(", ")}`);
      else if (outcome.kind === "matched_via_brand") console.log(`  ${caseId}  brand "${outcome.brandName}" -> drug(s) ${outcome.drugIds.join(", ")}`);
    }
  }

  if (summary.status === "FAILED") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[litigation-complaints] fatal error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
