import { prisma } from "@/lib/prisma";
import { classifyModality } from "@/lib/classification/modality";
import { classifyDrugClass } from "@/lib/classification/drugClass";
import { DEFAULT_INGESTION_CONCURRENCY, dedupeByKey, mapWithConcurrency } from "../shared";
import type {
  ParsedBiologicExclusivity,
  ParsedBiologicPatent,
  ParsedBiologicProduct,
  RowIssue,
} from "./types";

const CONCURRENCY = DEFAULT_INGESTION_CONCURRENCY;

export interface LoadResult {
  productsUpserted: number;
  patentsUpserted: number;
  exclusivitiesUpserted: number;
  productsSkipped: number;
  patentsSkipped: number;
  exclusivitiesSkipped: number;
  referenceProductsResolved: number;
  referenceProductsUnresolved: number;
  ingestionRecordsCreated: number;
}

export async function loadPurpleBookData(
  parsed: {
    products: ParsedBiologicProduct[];
    exclusivities: ParsedBiologicExclusivity[];
    patents: ParsedBiologicPatent[];
  },
  opts: { sourceId: string; verifiedAt: Date; issues: RowIssue[]; signal?: AbortSignal },
): Promise<LoadResult> {
  const { sourceId, verifiedAt, issues, signal } = opts;

  const products = dedupeByKey(parsed.products, (p) => p.blaProductKey);
  const exclusivities = dedupeByKey(
    parsed.exclusivities,
    (e) => `${e.blaProductKey}::${e.code}::${e.expirationDate.toISOString()}`,
  );
  const patents = dedupeByKey(parsed.patents, (p) => `${p.blaNumber}::${p.patentNumber}`);
  for (const [label, before, after] of [
    ["products.csv (products)", parsed.products.length, products.length],
    ["products.csv (exclusivities)", parsed.exclusivities.length, exclusivities.length],
    ["patent-list.html", parsed.patents.length, patents.length],
  ] as const) {
    if (before !== after) {
      issues.push({
        file: label.startsWith("patent") ? "patent-list.html" : "products.csv",
        line: -1,
        reason: `deduplicated ${before - after} row(s) sharing a natural key that was already seen in this run`,
        raw: "",
      });
    }
  }

  // 1. Companies — same upsert-by-name pattern as Orange Book, and the
  // same Company table (a firm can hold both NDA/ANDA and BLA applications).
  const companyNames = [...new Set(products.map((p) => p.companyName))];
  const companyIdByName = new Map<string, string>();
  for (const name of companyNames) {
    const company = await prisma.company.upsert({ where: { name }, update: {}, create: { name } });
    companyIdByName.set(name, company.id);
  }

  // 2. BiologicProducts. Classified at ingestion time with fallback
  // "UNCLASSIFIED" (never "SMALL_MOLECULE") — see
  // src/lib/classification/modality.ts's doc comment on why the fallback
  // differs by source.
  let productsUpserted = 0;
  let productsSkipped = 0;
  const productIdByKey = new Map<string, string>();
  // For reference-product name resolution in step 3: every product's own
  // (proprietaryName, properName) -> id, built as we go.
  const idByProprietaryName = new Map<string, string>();
  const idByProperName = new Map<string, string>();

  await mapWithConcurrency(products, CONCURRENCY, async (product) => {
    const companyId = companyIdByName.get(product.companyName);
    if (!companyId) {
      productsSkipped++;
      issues.push({ file: "products.csv", line: -1, reason: `no resolved company id for "${product.companyName}"`, raw: product.blaProductKey });
      return;
    }

    const modality = classifyModality(product.properName, "UNCLASSIFIED");
    const drugClass = classifyDrugClass(product.properName);

    try {
      const row = await prisma.biologicProduct.upsert({
        where: { blaNumber_productNumber: { blaNumber: product.blaNumber, productNumber: product.productNumber } },
        update: {
          companyId,
          proprietaryName: product.proprietaryName,
          properName: product.properName,
          licenseType: product.licenseType,
          center: product.center,
          dosageForm: product.dosageForm,
          route: product.route,
          strength: product.strength,
          marketingStatus: product.marketingStatus,
          approvalDate: product.approvalDate,
          referenceProductNameRaw: product.referenceProductProprietaryNameRaw,
          modality,
          drugClass,
        },
        create: {
          companyId,
          blaNumber: product.blaNumber,
          productNumber: product.productNumber,
          proprietaryName: product.proprietaryName,
          properName: product.properName,
          licenseType: product.licenseType,
          center: product.center,
          dosageForm: product.dosageForm,
          route: product.route,
          strength: product.strength,
          marketingStatus: product.marketingStatus,
          approvalDate: product.approvalDate,
          referenceProductNameRaw: product.referenceProductProprietaryNameRaw,
          modality,
          drugClass,
        },
      });
      productIdByKey.set(product.blaProductKey, row.id);
      idByProprietaryName.set(product.proprietaryName.toLowerCase(), row.id);
      idByProperName.set(product.properName.toLowerCase(), row.id);
      productsUpserted++;
    } catch (error) {
      productsSkipped++;
      issues.push({
        file: "products.csv",
        line: -1,
        reason: `DB upsert failed: ${error instanceof Error ? error.message : String(error)}`,
        raw: product.blaProductKey,
      });
    }
  }, signal);

  // 3. Reference-product resolution — a second pass, now that every
  // product in this run has an id. Purple Book gives the reference
  // product's NAME, not its BLA number (see types.ts), so this is a
  // best-effort name match against what's already been upserted; unlike
  // Company matching (which always finds-or-creates and can't fail), this
  // genuinely can fail to resolve — e.g. the referenced product might use
  // a slightly different name than its own proprietary/proper name would
  // suggest. When it fails, referenceProductId stays null but
  // referenceProductNameRaw (already written in step 2) preserves the
  // source's raw name — never silently dropped.
  let referenceProductsResolved = 0;
  let referenceProductsUnresolved = 0;

  const resolutions = products
    .filter((p) => p.referenceProductProprietaryNameRaw || p.referenceProductProperNameRaw)
    .map((p) => {
      const id = productIdByKey.get(p.blaProductKey);
      const targetId =
        (p.referenceProductProprietaryNameRaw &&
          idByProprietaryName.get(p.referenceProductProprietaryNameRaw.toLowerCase())) ||
        (p.referenceProductProperNameRaw && idByProperName.get(p.referenceProductProperNameRaw.toLowerCase())) ||
        null;
      return { id, targetId, product: p };
    })
    .filter((r): r is { id: string; targetId: string | null; product: ParsedBiologicProduct } => Boolean(r.id));

  for (const { id, targetId, product } of resolutions) {
    if (targetId && targetId !== id) {
      await prisma.biologicProduct.update({ where: { id }, data: { referenceProductId: targetId } });
      referenceProductsResolved++;
    } else {
      referenceProductsUnresolved++;
      issues.push({
        file: "products.csv",
        line: -1,
        reason: `could not resolve reference product "${product.referenceProductProprietaryNameRaw ?? product.referenceProductProperNameRaw}" to a known BiologicProduct — kept as referenceProductNameRaw`,
        raw: product.blaProductKey,
      });
    }
  }

  // 4. Exclusivities.
  let exclusivitiesUpserted = 0;
  let exclusivitiesSkipped = 0;
  const exclusivityIds: string[] = [];

  await mapWithConcurrency(exclusivities, CONCURRENCY, async (excl) => {
    const biologicProductId = productIdByKey.get(excl.blaProductKey);
    if (!biologicProductId) {
      exclusivitiesSkipped++;
      issues.push({ file: "products.csv", line: -1, reason: `no BiologicProduct found for key "${excl.blaProductKey}"`, raw: excl.code });
      return;
    }
    try {
      const row = await prisma.exclusivity.upsert({
        where: { biologicProductId_code_expirationDate: { biologicProductId, code: excl.code, expirationDate: excl.expirationDate } },
        update: {},
        create: { biologicProductId, code: excl.code, expirationDate: excl.expirationDate },
      });
      exclusivityIds.push(row.id);
      exclusivitiesUpserted++;
    } catch (error) {
      exclusivitiesSkipped++;
      issues.push({
        file: "products.csv",
        line: -1,
        reason: `DB upsert failed: ${error instanceof Error ? error.message : String(error)}`,
        raw: excl.code,
      });
    }
  }, signal);

  // 5. Patents — from the separate, much sparser patent-list source (see
  // parsePatentList.ts). Matched by BLA number only: the patent list has
  // no product-number grain, so a disclosed patent applies to every
  // BiologicProduct row sharing that BLA number (mirrors how a real
  // reference product's patents cover the product as a whole, not one
  // specific strength/presentation).
  let patentsUpserted = 0;
  let patentsSkipped = 0;
  const patentIds: string[] = [];

  const blaToProductIds = new Map<string, string[]>();
  for (const p of products) {
    const id = productIdByKey.get(p.blaProductKey);
    if (!id) continue;
    const list = blaToProductIds.get(p.blaNumber) ?? [];
    list.push(id);
    blaToProductIds.set(p.blaNumber, list);
  }

  const patentTargets = patents.flatMap((patent) => {
    const productIds = blaToProductIds.get(patent.blaNumber);
    if (!productIds || productIds.length === 0) {
      issues.push({ file: "patent-list.html", line: -1, reason: `no BiologicProduct found for reference BLA number "${patent.blaNumber}" — patent not loaded`, raw: patent.patentNumber });
      return [];
    }
    return productIds.map((biologicProductId) => ({ biologicProductId, patent }));
  });

  await mapWithConcurrency(patentTargets, CONCURRENCY, async ({ biologicProductId, patent }) => {
    try {
      const whereKey = { biologicProductId_patentNumber: { biologicProductId, patentNumber: patent.patentNumber } } as const;

      // Purple Book publishes only the patent number and a single
      // source-asserted expiration date — no filing date, no PTA
      // adjustment, no use code (see README on why this pipeline's patent
      // data is thinner than Orange Book's). nominalExpiryDate and
      // effectiveExpiryDate both start equal to that source-asserted date,
      // filingDate stays null — the exact same "not yet PTA-enriched"
      // starting state Orange Book patents have before enrichment runs, so
      // the existing PTA pipeline (src/lib/ingestion/pta/) picks these up
      // as ordinary candidates with zero special-casing. Same clobber-guard
      // as Orange Book's loader: a non-null filingDate on the existing row
      // means PTA enrichment already ran, so a routine Purple Book refresh
      // must not overwrite that correction back to the naive source date.
      const existing = await prisma.patent.findUnique({ where: whereKey, select: { filingDate: true } });
      const alreadyPtaEnriched = existing?.filingDate != null;

      const row = await prisma.patent.upsert({
        where: whereKey,
        update: {
          ...(alreadyPtaEnriched
            ? {}
            : { nominalExpiryDate: patent.sourceExpirationDate, effectiveExpiryDate: patent.sourceExpirationDate }),
        },
        create: {
          biologicProductId,
          patentNumber: patent.patentNumber,
          nominalExpiryDate: patent.sourceExpirationDate,
          effectiveExpiryDate: patent.sourceExpirationDate,
        },
      });
      patentIds.push(row.id);
      patentsUpserted++;
    } catch (error) {
      patentsSkipped++;
      issues.push({
        file: "patent-list.html",
        line: -1,
        reason: `DB upsert failed: ${error instanceof Error ? error.message : String(error)}`,
        raw: patent.patentNumber,
      });
    }
  }, signal);

  // 6. Provenance — one IngestionRecord per successfully touched entity.
  const productIds = [...productIdByKey.values()];
  const ingestionRecords = await prisma.ingestionRecord.createMany({
    data: [
      ...productIds.map((biologicProductId) => ({ sourceId, biologicProductId, verifiedAt })),
      ...patentIds.map((patentId) => ({ sourceId, patentId, verifiedAt })),
      ...exclusivityIds.map((exclusivityId) => ({ sourceId, exclusivityId, verifiedAt })),
    ],
  });

  return {
    productsUpserted,
    patentsUpserted,
    exclusivitiesUpserted,
    productsSkipped,
    patentsSkipped,
    exclusivitiesSkipped,
    referenceProductsResolved,
    referenceProductsUnresolved,
    ingestionRecordsCreated: ingestionRecords.count,
  };
}
