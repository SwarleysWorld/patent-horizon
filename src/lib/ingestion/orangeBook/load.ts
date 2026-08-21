import { prisma } from "@/lib/prisma";
import { classifyModality } from "@/lib/classification/modality";
import { classifyDrugClass } from "@/lib/classification/drugClass";
import { DEFAULT_INGESTION_CONCURRENCY, dedupeByKey, mapWithConcurrency } from "../shared";
import type { ParsedExclusivity, ParsedPatent, ParsedProduct, RowIssue } from "./types";

const CONCURRENCY = DEFAULT_INGESTION_CONCURRENCY;

export interface LoadResult {
  drugsUpserted: number;
  patentsUpserted: number;
  exclusivitiesUpserted: number;
  drugsSkipped: number;
  patentsSkipped: number;
  exclusivitiesSkipped: number;
  ingestionRecordsCreated: number;
}

// dedupeByKey: source files can contain literal duplicate rows — see
// src/lib/ingestion/shared.ts for the full rationale.

export async function loadOrangeBookData(
  parsed: { products: ParsedProduct[]; patents: ParsedPatent[]; exclusivities: ParsedExclusivity[] },
  opts: { sourceId: string; verifiedAt: Date; issues: RowIssue[]; signal?: AbortSignal },
): Promise<LoadResult> {
  const { sourceId, verifiedAt, issues, signal } = opts;

  const products = dedupeByKey(parsed.products, (p) => p.drugKey);
  const patents = dedupeByKey(parsed.patents, (p) => `${p.drugKey}::${p.patentNumber}::${p.useCode}`);
  const exclusivities = dedupeByKey(
    parsed.exclusivities,
    (e) => `${e.drugKey}::${e.code}::${e.expirationDate.toISOString()}`,
  );
  for (const [label, before, after] of [
    ["products.txt", parsed.products.length, products.length],
    ["patent.txt (post-grouping)", parsed.patents.length, patents.length],
    ["exclusivity.txt", parsed.exclusivities.length, exclusivities.length],
  ] as const) {
    if (before !== after) {
      issues.push({
        file: label === "products.txt" ? "products.txt" : label.startsWith("patent") ? "patent.txt" : "exclusivity.txt",
        line: -1,
        reason: `deduplicated ${before - after} row(s) sharing a natural key that was already seen in this run`,
        raw: "",
      });
    }
  }

  // 1. Companies — small, distinct set; upsert sequentially and build a
  // name -> id map for the Drug pass.
  const companyNames = [...new Set(products.map((p) => p.companyName))];
  const companyIdByName = new Map<string, string>();
  for (const name of companyNames) {
    const company = await prisma.company.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    companyIdByName.set(name, company.id);
  }

  // 2. Drugs.
  let drugsUpserted = 0;
  let drugsSkipped = 0;
  const drugIdByKey = new Map<string, string>();

  await mapWithConcurrency(products, CONCURRENCY, async (product) => {
    const companyId = companyIdByName.get(product.companyName);
    if (!companyId) {
      drugsSkipped++;
      issues.push({
        file: "products.txt",
        line: -1,
        reason: `no resolved company id for "${product.companyName}"`,
        raw: product.drugKey,
      });
      return;
    }
    // Classified from genericName at ingestion time (not just once via a
    // backfill script) so a re-run always reflects the current classifier
    // — including picking up improvements if the stem rules are extended
    // later, the same way any other re-ingested field self-heals.
    const modality = classifyModality(product.genericName, "SMALL_MOLECULE");
    const drugClass = classifyDrugClass(product.genericName);

    try {
      const drug = await prisma.drug.upsert({
        where: {
          applicationNumber_productNumber: {
            applicationNumber: product.applicationNumber,
            productNumber: product.productNumber,
          },
        },
        update: {
          brandName: product.brandName,
          genericName: product.genericName,
          companyId,
          applicationType: product.applicationType,
          dosageForm: product.dosageForm,
          route: product.route,
          strength: product.strength,
          approvalDate: product.approvalDate,
          modality,
          drugClass,
        },
        create: {
          brandName: product.brandName,
          genericName: product.genericName,
          companyId,
          applicationType: product.applicationType,
          applicationNumber: product.applicationNumber,
          productNumber: product.productNumber,
          dosageForm: product.dosageForm,
          route: product.route,
          strength: product.strength,
          approvalDate: product.approvalDate,
          modality,
          drugClass,
        },
      });
      drugIdByKey.set(product.drugKey, drug.id);
      drugsUpserted++;
    } catch (error) {
      drugsSkipped++;
      issues.push({
        file: "products.txt",
        line: -1,
        reason: `DB upsert failed: ${error instanceof Error ? error.message : String(error)}`,
        raw: product.drugKey,
      });
    }
  }, signal);

  // 3. Patents.
  let patentsUpserted = 0;
  let patentsSkipped = 0;
  const patentIds: string[] = [];

  await mapWithConcurrency(patents, CONCURRENCY, async (patent) => {
    const drugId = drugIdByKey.get(patent.drugKey);
    if (!drugId) {
      patentsSkipped++;
      issues.push({
        file: "patent.txt",
        line: -1,
        reason: `no Drug found for key "${patent.drugKey}"`,
        raw: patent.patentNumber,
      });
      return;
    }
    try {
      const whereKey = {
        drugId_patentNumber_useCode: {
          drugId,
          patentNumber: patent.patentNumber,
          useCode: patent.useCode,
        },
      } as const;

      // Orange Book is not the only writer of effectiveExpiryDate /
      // expiryAdjustmentDays — the USPTO PTA enrichment pipeline
      // (src/lib/ingestion/pta) independently recomputes those two fields
      // from authoritative filing-date + adjustment data. Orange Book
      // never sets filingDate itself, so a non-null filingDate on the
      // existing row is a reliable signal that PTA enrichment has already
      // run for this patent — in that case, a routine Orange Book refresh
      // must not clobber that correction back to the naive listed date.
      const existing = await prisma.patent.findUnique({
        where: whereKey,
        select: { filingDate: true },
      });
      const alreadyPtaEnriched = existing?.filingDate != null;

      const row = await prisma.patent.upsert({
        where: whereKey,
        update: {
          coversDrugSubstance: patent.coversDrugSubstance,
          coversDrugProduct: patent.coversDrugProduct,
          nominalExpiryDate: patent.nominalExpiryDate,
          submittedDate: patent.submittedDate,
          ...(alreadyPtaEnriched
            ? {}
            : { effectiveExpiryDate: patent.effectiveExpiryDate, expiryAdjustmentDays: patent.expiryAdjustmentDays }),
        },
        create: {
          drugId,
          patentNumber: patent.patentNumber,
          coversDrugSubstance: patent.coversDrugSubstance,
          coversDrugProduct: patent.coversDrugProduct,
          useCode: patent.useCode,
          nominalExpiryDate: patent.nominalExpiryDate,
          effectiveExpiryDate: patent.effectiveExpiryDate,
          expiryAdjustmentDays: patent.expiryAdjustmentDays,
          submittedDate: patent.submittedDate,
        },
      });
      patentIds.push(row.id);
      patentsUpserted++;
    } catch (error) {
      patentsSkipped++;
      issues.push({
        file: "patent.txt",
        line: -1,
        reason: `DB upsert failed: ${error instanceof Error ? error.message : String(error)}`,
        raw: patent.patentNumber,
      });
    }
  }, signal);

  // 4. Exclusivities.
  let exclusivitiesUpserted = 0;
  let exclusivitiesSkipped = 0;
  const exclusivityIds: string[] = [];

  await mapWithConcurrency(exclusivities, CONCURRENCY, async (excl) => {
    const drugId = drugIdByKey.get(excl.drugKey);
    if (!drugId) {
      exclusivitiesSkipped++;
      issues.push({
        file: "exclusivity.txt",
        line: -1,
        reason: `no Drug found for key "${excl.drugKey}"`,
        raw: excl.code,
      });
      return;
    }
    try {
      const row = await prisma.exclusivity.upsert({
        where: {
          drugId_code_expirationDate: {
            drugId,
            code: excl.code,
            expirationDate: excl.expirationDate,
          },
        },
        update: {},
        create: {
          drugId,
          code: excl.code,
          expirationDate: excl.expirationDate,
        },
      });
      exclusivityIds.push(row.id);
      exclusivitiesUpserted++;
    } catch (error) {
      exclusivitiesSkipped++;
      issues.push({
        file: "exclusivity.txt",
        line: -1,
        reason: `DB upsert failed: ${error instanceof Error ? error.message : String(error)}`,
        raw: excl.code,
      });
    }
  }, signal);

  // 5. Provenance — one IngestionRecord per successfully touched entity,
  // all sharing this run's verifiedAt timestamp. Written in bulk rather
  // than per-row for speed; rawPayload is intentionally omitted here to
  // keep routine bulk loads cheap (see README).
  const drugIds = [...drugIdByKey.values()];
  const ingestionRecords = await prisma.ingestionRecord.createMany({
    data: [
      ...drugIds.map((drugId) => ({ sourceId, drugId, verifiedAt })),
      ...patentIds.map((patentId) => ({ sourceId, patentId, verifiedAt })),
      ...exclusivityIds.map((exclusivityId) => ({ sourceId, exclusivityId, verifiedAt })),
    ],
  });

  return {
    drugsUpserted,
    patentsUpserted,
    exclusivitiesUpserted,
    drugsSkipped,
    patentsSkipped,
    exclusivitiesSkipped,
    ingestionRecordsCreated: ingestionRecords.count,
  };
}
