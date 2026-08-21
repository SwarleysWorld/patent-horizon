import "dotenv/config";
import { runPtaEnrichment } from "../src/lib/ingestion/pta";
import { prisma } from "../src/lib/prisma";

function parseArgs(argv: string[]): { limit?: number; patentNumbers?: string[] } {
  const out: { limit?: number; patentNumbers?: string[] } = {};

  const limitIndex = argv.indexOf("--limit");
  if (limitIndex !== -1 && argv[limitIndex + 1]) {
    out.limit = Number(argv[limitIndex + 1]);
  }

  const patentIndex = argv.indexOf("--patent");
  if (patentIndex !== -1 && argv[patentIndex + 1]) {
    out.patentNumbers = argv[patentIndex + 1].split(",").map((s) => s.trim()).filter(Boolean);
  }

  return out;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

async function main() {
  const { limit, patentNumbers } = parseArgs(process.argv.slice(2));

  let patentIds: string[] | undefined;
  if (patentNumbers) {
    const rows = await prisma.patent.findMany({
      where: { patentNumber: { in: patentNumbers } },
      select: { id: true },
    });
    patentIds = rows.map((r) => r.id);
    console.log(`[pta-enrich] resolved ${patentNumbers.length} patent number(s) to ${patentIds.length} Patent row(s)`);
  }

  console.log(
    `[pta-enrich] starting${limit ? ` (limit ${limit})` : ""}${patentIds ? ` (explicit sample: ${patentIds.length} rows)` : ""}...`,
  );

  const summary = await runPtaEnrichment({ limit, patentIds });

  console.log("");
  console.log("=== PTA enrichment summary ===");
  console.log(`run id:    ${summary.runId}`);
  console.log(`status:    ${summary.status}`);
  console.log(`duration:  ${(summary.durationMs / 1000).toFixed(1)}s`);

  if (summary.status === "FAILED" && summary.candidateCount === 0) {
    console.error(`error: ${summary.errorMessage}`);
    process.exitCode = 1;
    return;
  }

  console.log(`candidates examined: ${summary.candidateCount}`);
  console.log(`  updated (real PTA data applied): ${summary.updated}`);
  console.log(`  no data (checked, none available): ${summary.noData}`);
  console.log(`  flagged (suspiciously large gap, needs manual review): ${summary.flagged}`);
  console.log(`  errors: ${summary.errors}`);
  if (summary.errorMessage) console.log(`  ${summary.errorMessage}`);

  if (summary.results.length > 0) {
    console.log("");
    console.log("--- per-patent results ---");
    for (const row of summary.results) {
      const name = row.drugId
        ? (await prisma.drug.findUnique({ where: { id: row.drugId }, select: { brandName: true } }))?.brandName
        : row.biologicProductId
          ? (await prisma.biologicProduct.findUnique({ where: { id: row.biologicProductId }, select: { proprietaryName: true } }))
              ?.proprietaryName
          : undefined;
      const label = `${row.patentNumber} (${name ?? "?"})`;

      if (row.outcome.kind === "updated") {
        const { before, after, ptaDays, filingDate } = row.outcome;
        console.log(`\n${label}`);
        console.log(`  filing date (USPTO):      ${fmtDate(filingDate)}`);
        console.log(`  USPTO PTA days:           ${ptaDays}`);
        console.log(`  Orange Book listed date:  ${fmtDate(before.nominal)}  (unchanged)`);
        console.log(`  effective, before:        ${fmtDate(before.effective)}  (adjustment: ${before.adjustment ?? "unconfirmed"})`);
        console.log(`  effective, after:         ${fmtDate(after.effective)}  (adjustment: ${after.adjustment}d vs. listed)`);
      } else if (row.outcome.kind === "no_data") {
        console.log(`\n${label}\n  no data: ${row.outcome.reason}`);
      } else if (row.outcome.kind === "flagged") {
        const { existingNominal, computedEffective, gapDays, ptaDays, filingDate } = row.outcome;
        console.log(`\n${label}\n  FLAGGED, not applied: ${row.outcome.reason}`);
        console.log(`  filing date (USPTO):      ${fmtDate(filingDate)}`);
        console.log(`  USPTO PTA days:           ${ptaDays}`);
        console.log(`  existing listed date:     ${fmtDate(existingNominal)}  (left unchanged)`);
        console.log(`  computed (not written):   ${fmtDate(computedEffective)}  (${gapDays}d gap)`);
      } else {
        console.log(`\n${label}\n  ERROR: ${row.outcome.message}`);
      }
    }
  }
}

main()
  .catch((error) => {
    console.error("[pta-enrich] fatal error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
