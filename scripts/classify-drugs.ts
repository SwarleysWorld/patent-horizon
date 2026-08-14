import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { classifyModality, MODALITY_LABELS, type DrugModality } from "../src/lib/classification/modality";
import { classifyDrugClass } from "../src/lib/classification/drugClass";

// Backfills modality/drugClass for drugs already in the database — needed
// because the Orange Book ingestion pipeline only classifies at
// insert/update time (src/lib/ingestion/orangeBook/load.ts) going forward;
// it doesn't retroactively touch rows loaded before that classification
// existed. Safe to re-run any time (e.g. after adding a new stem rule) —
// it always recomputes from the current genericName and classifier, never
// accumulates drift.

function parseArgs(argv: string[]): { limit?: number; dryRun: boolean } {
  const out: { limit?: number; dryRun: boolean } = { dryRun: argv.includes("--dry-run") };
  const limitIndex = argv.indexOf("--limit");
  if (limitIndex !== -1 && argv[limitIndex + 1]) out.limit = Number(argv[limitIndex + 1]);
  return out;
}

async function main() {
  const { limit, dryRun } = parseArgs(process.argv.slice(2));

  console.log(`[classify-drugs] loading drugs${limit ? ` (limit ${limit})` : ""}...`);
  const drugs = await prisma.drug.findMany({
    select: { id: true, genericName: true, modality: true, drugClass: true },
    ...(limit ? { take: limit } : {}),
  });
  console.log(`[classify-drugs] classifying ${drugs.length} drug(s)...`);

  // Group ids by the resulting (modality, drugClass) pair so the actual
  // writes are a handful of bulk `UPDATE ... WHERE id = ANY(...)` calls
  // instead of one round trip per drug — the difference between seconds
  // and minutes at this row count.
  const groups = new Map<string, { modality: DrugModality; drugClass: string | null; ids: string[] }>();
  let changed = 0;
  const modalityCounts: Record<DrugModality, number> = {
    SMALL_MOLECULE: 0,
    PEPTIDE: 0,
    OLIGONUCLEOTIDE: 0,
    MONOCLONAL_ANTIBODY: 0,
    OTHER: 0,
  };
  const classCounts = new Map<string, number>();

  for (const drug of drugs) {
    const modality = classifyModality(drug.genericName);
    const drugClass = classifyDrugClass(drug.genericName);
    modalityCounts[modality]++;
    if (drugClass) classCounts.set(drugClass, (classCounts.get(drugClass) ?? 0) + 1);

    if (drug.modality !== modality || drug.drugClass !== drugClass) {
      changed++;
      const key = `${modality}::${drugClass ?? ""}`;
      const group = groups.get(key) ?? { modality, drugClass, ids: [] };
      group.ids.push(drug.id);
      groups.set(key, group);
    }
  }

  console.log("");
  console.log("=== Modality distribution (all classified drugs) ===");
  for (const [modality, count] of Object.entries(modalityCounts)) {
    console.log(`  ${MODALITY_LABELS[modality as DrugModality].padEnd(24)} ${count}`);
  }

  console.log("");
  console.log("=== Drug class tags (best-effort, not exhaustive) ===");
  const sortedClasses = [...classCounts.entries()].sort((a, b) => b[1] - a[1]);
  if (sortedClasses.length === 0) console.log("  (none matched)");
  for (const [label, count] of sortedClasses) {
    console.log(`  ${label.padEnd(32)} ${count}`);
  }

  console.log("");
  console.log(`${changed} of ${drugs.length} drug(s) need an update (${groups.size} distinct group(s)).`);

  if (dryRun) {
    console.log("[classify-drugs] --dry-run set — no changes written.");
    return;
  }

  let written = 0;
  for (const group of groups.values()) {
    await prisma.$executeRaw`
      UPDATE "Drug"
      SET modality = ${group.modality}::"DrugModality", "drugClass" = ${group.drugClass}
      WHERE id = ANY(${group.ids}::text[])
    `;
    written += group.ids.length;
  }
  console.log(`[classify-drugs] wrote ${written} update(s).`);
}

main()
  .catch((error) => {
    console.error("[classify-drugs] fatal error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
