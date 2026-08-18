import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { classifyModality, MODALITY_LABELS, MODALITY_VALUES, type Modality } from "../src/lib/classification/modality";
import { classifyDrugClass } from "../src/lib/classification/drugClass";

// Backfills modality/drugClass for both Drug (Orange Book) and
// BiologicProduct (Purple Book) rows already in the database — needed
// because each ingestion pipeline only classifies at insert/update time; it
// doesn't retroactively touch rows loaded before a classifier change (e.g.
// a new stem rule, or the longest-match-first engine rewrite). Safe to
// re-run any time — it always recomputes from the current name and
// classifier, never accumulates drift.
//
// The two sources use different fallbacks when nothing matches — Orange
// Book (small-molecule regulatory pathway) falls back to SMALL_MOLECULE;
// Purple Book (biologics pathway) falls back to UNCLASSIFIED, since an
// unmatched biologic name is definitely not a small molecule. See
// classifyModality's doc comment in src/lib/classification/modality.ts.

function parseArgs(argv: string[]): { limit?: number; dryRun: boolean } {
  const out: { limit?: number; dryRun: boolean } = { dryRun: argv.includes("--dry-run") };
  const limitIndex = argv.indexOf("--limit");
  if (limitIndex !== -1 && argv[limitIndex + 1]) out.limit = Number(argv[limitIndex + 1]);
  return out;
}

interface Row {
  id: string;
  name: string;
  modality: Modality;
  drugClass: string | null;
}

interface SourceReport {
  label: string;
  total: number;
  changed: number;
  beforeModalityCounts: Record<Modality, number>;
  afterModalityCounts: Record<Modality, number>;
  afterClassCounts: Map<string, number>;
}

function emptyModalityCounts(): Record<Modality, number> {
  return Object.fromEntries(MODALITY_VALUES.map((m) => [m, 0])) as Record<Modality, number>;
}

// Groups ids by the resulting (modality, drugClass) pair so the actual
// writes are a handful of bulk `UPDATE ... WHERE id = ANY(...)` calls
// instead of one round trip per row — the difference between seconds and
// minutes at Orange Book's row count.
async function classifySource(
  label: string,
  rows: Row[],
  fallback: Modality,
  write: (group: { modality: Modality; drugClass: string | null; ids: string[] }) => Promise<void>,
  dryRun: boolean,
): Promise<SourceReport> {
  const beforeModalityCounts = emptyModalityCounts();
  const afterModalityCounts = emptyModalityCounts();
  const afterClassCounts = new Map<string, number>();
  const groups = new Map<string, { modality: Modality; drugClass: string | null; ids: string[] }>();
  let changed = 0;

  for (const row of rows) {
    beforeModalityCounts[row.modality]++;

    const modality = classifyModality(row.name, fallback);
    const drugClass = classifyDrugClass(row.name);
    afterModalityCounts[modality]++;
    if (drugClass) afterClassCounts.set(drugClass, (afterClassCounts.get(drugClass) ?? 0) + 1);

    if (row.modality !== modality || row.drugClass !== drugClass) {
      changed++;
      const key = `${modality}::${drugClass ?? ""}`;
      const group = groups.get(key) ?? { modality, drugClass, ids: [] };
      group.ids.push(row.id);
      groups.set(key, group);
    }
  }

  if (!dryRun) {
    for (const group of groups.values()) await write(group);
  }

  return { label, total: rows.length, changed, beforeModalityCounts, afterModalityCounts, afterClassCounts };
}

function printReport(report: SourceReport) {
  const { label, total, changed, beforeModalityCounts, afterModalityCounts, afterClassCounts } = report;
  const beforeUnclassified = beforeModalityCounts.UNCLASSIFIED;
  const afterUnclassified = afterModalityCounts.UNCLASSIFIED;
  const pct = (n: number) => (total === 0 ? "0.0" : ((n / total) * 100).toFixed(1));

  console.log(`\n=== ${label} (${total} row(s)) ===`);
  console.log(`unclassified rate: ${pct(beforeUnclassified)}% before -> ${pct(afterUnclassified)}% after (${beforeUnclassified} -> ${afterUnclassified} of ${total})`);
  console.log(`${changed} of ${total} row(s) changed modality and/or drugClass.`);

  console.log("modality distribution (after):");
  for (const modality of MODALITY_VALUES) {
    const count = afterModalityCounts[modality];
    if (count === 0) continue;
    console.log(`  ${MODALITY_LABELS[modality].padEnd(24)} ${count}`);
  }

  const sortedClasses = [...afterClassCounts.entries()].sort((a, b) => b[1] - a[1]);
  if (sortedClasses.length > 0) {
    console.log("drugClass tags (after, best-effort, not exhaustive):");
    for (const [label2, count] of sortedClasses) {
      console.log(`  ${label2.padEnd(32)} ${count}`);
    }
  }
}

async function main() {
  const { limit, dryRun } = parseArgs(process.argv.slice(2));

  console.log(`[classify-drugs] loading rows${limit ? ` (limit ${limit} per source)` : ""}...`);

  const drugs = await prisma.drug.findMany({
    select: { id: true, genericName: true, modality: true, drugClass: true },
    ...(limit ? { take: limit } : {}),
  });
  const biologics = await prisma.biologicProduct.findMany({
    select: { id: true, properName: true, modality: true, drugClass: true },
    ...(limit ? { take: limit } : {}),
  });

  console.log(`[classify-drugs] classifying ${drugs.length} drug(s) + ${biologics.length} biologic product(s)...`);

  const drugReport = await classifySource(
    "Orange Book (Drug)",
    drugs.map((d) => ({ id: d.id, name: d.genericName, modality: d.modality, drugClass: d.drugClass })),
    "SMALL_MOLECULE",
    async (group) => {
      await prisma.$executeRaw`
        UPDATE "Drug"
        SET modality = ${group.modality}::"Modality", "drugClass" = ${group.drugClass}
        WHERE id = ANY(${group.ids}::text[])
      `;
    },
    dryRun,
  );

  const biologicReport = await classifySource(
    "Purple Book (BiologicProduct)",
    biologics.map((b) => ({ id: b.id, name: b.properName, modality: b.modality, drugClass: b.drugClass })),
    "UNCLASSIFIED",
    async (group) => {
      await prisma.$executeRaw`
        UPDATE "BiologicProduct"
        SET modality = ${group.modality}::"Modality", "drugClass" = ${group.drugClass}
        WHERE id = ANY(${group.ids}::text[])
      `;
    },
    dryRun,
  );

  printReport(drugReport);
  printReport(biologicReport);

  console.log("");
  if (dryRun) {
    console.log("[classify-drugs] --dry-run set — no changes written.");
  } else {
    console.log(`[classify-drugs] wrote ${drugReport.changed + biologicReport.changed} update(s).`);
  }
}

main()
  .catch((error) => {
    console.error("[classify-drugs] fatal error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
