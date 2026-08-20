import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./helpers";
import { getPortfolioStats, getRecentActivity, getActivityPage } from "@/lib/home/activity";
import { PTA_SOURCE_NAME } from "@/lib/ingestion/pta/enrich";

let companyId: string;

beforeEach(async () => {
  await resetDb();
  const company = await prisma.company.create({ data: { name: "Acme Pharma" } });
  companyId = company.id;
});

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

async function createDrug(overrides: { applicationNumber?: string; brandName?: string } = {}) {
  return prisma.drug.create({
    data: {
      companyId,
      brandName: "TestDrug",
      genericName: "testine",
      applicationType: "NDA",
      applicationNumber: "NDA800001",
      productNumber: "001",
      dosageForm: "TABLET",
      route: "ORAL",
      strength: "10MG",
      ...overrides,
    },
  });
}

describe("getPortfolioStats", () => {
  it("counts tracked products across both sources", async () => {
    await createDrug();
    await prisma.biologicProduct.create({
      data: {
        companyId,
        blaNumber: "BLA8001",
        productNumber: "001",
        proprietaryName: "TestBio",
        properName: "testibio",
        licenseType: "STANDARD",
        center: "CDER",
        dosageForm: "INJECTION",
        route: "INTRAVENOUS",
        strength: "100MG",
      },
    });
    const stats = await getPortfolioStats();
    expect(stats.totalTracked).toBe(2);
  });

  it("buckets expiring-soon counts by horizon", async () => {
    const soon = await createDrug({ applicationNumber: "NDA800002" });
    const later = await createDrug({ applicationNumber: "NDA800003" });
    await prisma.patent.create({
      data: { drugId: soon.id, patentNumber: "P1", nominalExpiryDate: daysFromNow(10), effectiveExpiryDate: daysFromNow(10) },
    });
    await prisma.patent.create({
      data: { drugId: later.id, patentNumber: "P2", nominalExpiryDate: daysFromNow(200), effectiveExpiryDate: daysFromNow(200) },
    });
    const stats = await getPortfolioStats();
    expect(stats.within30Days).toBe(1);
    expect(stats.within365Days).toBe(2);
  });

  it("counts active generic challenges — excludes EXTINGUISHED", async () => {
    const drug = await createDrug({ applicationNumber: "NDA800004" });
    await prisma.genericChallenge.create({
      data: {
        naturalKeyNda: "NDA800004", activeIngredient: "testine", dosageForm: "TABLET", strength: "10MG",
        rldName: "TestDrug", rldNdaNumber: "NDA800004", submissionDateType: "EXACT_DATE",
        currentStatus: "ELIGIBLE", decisionHistory: [], rawStrengthText: "10MG",
        drugLinks: { create: { drugId: drug.id } },
      },
    });
    const extinguished = await createDrug({ applicationNumber: "NDA800005" });
    await prisma.genericChallenge.create({
      data: {
        naturalKeyNda: "NDA800005", activeIngredient: "testine", dosageForm: "TABLET", strength: "10MG",
        rldName: "TestDrug", rldNdaNumber: "NDA800005", submissionDateType: "EXACT_DATE",
        currentStatus: "EXTINGUISHED", decisionHistory: [], rawStrengthText: "10MG",
        drugLinks: { create: { drugId: extinguished.id } },
      },
    });
    const stats = await getPortfolioStats();
    expect(stats.activeChallenges).toBe(1);
  });

  it("counts a drug once when its generic entry beat the computed estimate", async () => {
    const drug = await createDrug({ applicationNumber: "NDA800006" });
    await prisma.patent.create({
      data: { drugId: drug.id, patentNumber: "P6", nominalExpiryDate: daysFromNow(3000), effectiveExpiryDate: daysFromNow(3000) },
    });
    await prisma.genericChallenge.create({
      data: {
        naturalKeyNda: "NDA800006", activeIngredient: "testine", dosageForm: "TABLET", strength: "10MG",
        rldName: "TestDrug", rldNdaNumber: "NDA800006", submissionDateType: "EXACT_DATE",
        dateOfFirstCommercialMarketing: daysFromNow(-30), decisionHistory: [], rawStrengthText: "10MG",
        drugLinks: { create: { drugId: drug.id } },
      },
    });
    const stats = await getPortfolioStats();
    expect(stats.divergenceCount).toBe(1);
  });

  it("does not count a challenge whose marketing date is after the computed estimate", async () => {
    const drug = await createDrug({ applicationNumber: "NDA800007" });
    await prisma.patent.create({
      data: { drugId: drug.id, patentNumber: "P7", nominalExpiryDate: daysFromNow(10), effectiveExpiryDate: daysFromNow(10) },
    });
    await prisma.genericChallenge.create({
      data: {
        naturalKeyNda: "NDA800007", activeIngredient: "testine", dosageForm: "TABLET", strength: "10MG",
        rldName: "TestDrug", rldNdaNumber: "NDA800007", submissionDateType: "EXACT_DATE",
        dateOfFirstCommercialMarketing: daysFromNow(3000), decisionHistory: [], rawStrengthText: "10MG",
        drugLinks: { create: { drugId: drug.id } },
      },
    });
    const stats = await getPortfolioStats();
    expect(stats.divergenceCount).toBe(0);
  });
});

describe("getRecentActivity", () => {
  it("uses the source's own submission date, not our ingestion timestamp — the bug being fixed here", async () => {
    const recentDrug = await createDrug({ applicationNumber: "NDA800008" });
    await prisma.genericChallenge.create({
      data: {
        naturalKeyNda: "NDA800008", activeIngredient: "testine", dosageForm: "TABLET", strength: "10MG",
        rldName: "TestDrug", rldNdaNumber: "NDA800008", submissionDateType: "EXACT_DATE",
        submissionDate: daysFromNow(-5),
        decisionHistory: [], rawStrengthText: "10MG",
        drugLinks: { create: { drugId: recentDrug.id } },
      },
    });
    const olderDrug = await createDrug({ applicationNumber: "NDA800009" });
    await prisma.genericChallenge.create({
      data: {
        naturalKeyNda: "NDA800009", activeIngredient: "testine", dosageForm: "TABLET", strength: "10MG",
        rldName: "TestDrug", rldNdaNumber: "NDA800009", submissionDateType: "EXACT_DATE",
        submissionDate: daysFromNow(-4000), // filed years ago, but both rows were INGESTED just now — createdAt would be identical for both
        decisionHistory: [], rawStrengthText: "10MG",
        drugLinks: { create: { drugId: olderDrug.id } },
      },
    });

    const items = await getRecentActivity(50);
    const recentIndex = items.findIndex((i) => i.href === `/drugs/${recentDrug.id}`);
    const olderIndex = items.findIndex((i) => i.href === `/drugs/${olderDrug.id}`);
    expect(recentIndex).toBeGreaterThanOrEqual(0);
    expect(olderIndex).toBeGreaterThanOrEqual(0);
    expect(recentIndex).toBeLessThan(olderIndex); // the recently-filed one sorts first, despite identical ingestion time
  });

  it("excludes a Pre-MMA challenge from new_challenge — it has no real submission date to sort by", async () => {
    const drug = await createDrug({ applicationNumber: "NDA800013" });
    await prisma.genericChallenge.create({
      data: {
        naturalKeyNda: "NDA800013", activeIngredient: "testine", dosageForm: "TABLET", strength: "10MG",
        rldName: "TestDrug", rldNdaNumber: "NDA800013", submissionDateType: "PRE_MMA",
        decisionHistory: [], rawStrengthText: "10MG",
        drugLinks: { create: { drugId: drug.id } },
      },
    });
    const items = await getRecentActivity(50);
    expect(items.some((i) => i.type === "new_challenge" && i.href === `/drugs/${drug.id}`)).toBe(false);
  });

  it("excludes a challenge with no linked drug — nowhere to click through to", async () => {
    await prisma.genericChallenge.create({
      data: {
        naturalKeyNda: "NO_NDA:Orphan", activeIngredient: "testine", dosageForm: "TABLET", strength: "10MG",
        rldName: "Orphan", rldNdaNumber: null, submissionDateType: "EXACT_DATE", submissionDate: new Date(),
        decisionHistory: [], rawStrengthText: "10MG",
      },
    });
    const items = await getRecentActivity(50);
    expect(items.some((i) => i.detail.includes("Orphan"))).toBe(false);
  });

  it("includes a posted 180-day decision using FDA's own posting date", async () => {
    const drug = await createDrug({ applicationNumber: "NDA800010" });
    await prisma.genericChallenge.create({
      data: {
        naturalKeyNda: "NDA800010", activeIngredient: "testine", dosageForm: "TABLET", strength: "10MG",
        rldName: "TestDrug", rldNdaNumber: "NDA800010", submissionDateType: "EXACT_DATE",
        currentStatus: "ELIGIBLE",
        decisionHistory: [{ status: "ELIGIBLE", postingDate: new Date().toISOString().slice(0, 10), rawStatusText: "Eligible" }],
        rawStrengthText: "10MG",
        drugLinks: { create: { drugId: drug.id } },
      },
    });
    const items = await getRecentActivity(50);
    expect(items.some((i) => i.type === "decision_posted" && i.href === `/drugs/${drug.id}`)).toBe(true);
  });

  it("uses the marketing date itself for marketing_recorded, not our ingestion timestamp", async () => {
    const drug = await createDrug({ applicationNumber: "NDA800014" });
    await prisma.genericChallenge.create({
      data: {
        naturalKeyNda: "NDA800014", activeIngredient: "testine", dosageForm: "TABLET", strength: "10MG",
        rldName: "TestDrug", rldNdaNumber: "NDA800014", submissionDateType: "EXACT_DATE",
        dateOfFirstCommercialMarketing: new Date("2015-06-01T00:00:00.000Z"),
        decisionHistory: [], rawStrengthText: "10MG",
        drugLinks: { create: { drugId: drug.id } },
      },
    });
    const items = await getRecentActivity(50);
    const item = items.find((i) => i.type === "marketing_recorded" && i.href === `/drugs/${drug.id}`);
    expect(item?.date).toBe("2015-06-01");
  });

  it("includes a day-level summary row once a patent term is confirmed via PTA source ingestion", async () => {
    const drug = await createDrug({ applicationNumber: "NDA800011" });
    const patent = await prisma.patent.create({
      data: {
        drugId: drug.id,
        patentNumber: "P11",
        nominalExpiryDate: daysFromNow(100),
        effectiveExpiryDate: daysFromNow(111),
        expiryAdjustmentDays: 11,
      },
    });
    const ptaSource = await prisma.dataSource.create({ data: { name: PTA_SOURCE_NAME } });
    await prisma.ingestionRecord.create({ data: { sourceId: ptaSource.id, patentId: patent.id } });

    const items = await getRecentActivity(50);
    const item = items.find((i) => i.type === "patent_confirmed");
    expect(item).toBeDefined();
    expect(item!.productName).toBe("1 product");
  });

  it("collapses many same-day confirmations into one row, not one per patent — the fix for a real bug where one large PTA run buried every other activity type", async () => {
    for (let i = 0; i < 25; i++) {
      const drug = await createDrug({ applicationNumber: `NDA80005${i}` });
      const patent = await prisma.patent.create({
        data: {
          drugId: drug.id, patentNumber: `P50${i}`,
          nominalExpiryDate: daysFromNow(100), effectiveExpiryDate: daysFromNow(100 + i), expiryAdjustmentDays: i,
        },
      });
      const ptaSource = await prisma.dataSource.upsert({
        where: { name: PTA_SOURCE_NAME }, update: {}, create: { name: PTA_SOURCE_NAME },
      });
      await prisma.ingestionRecord.create({ data: { sourceId: ptaSource.id, patentId: patent.id } });
    }
    const items = await getRecentActivity(50);
    const confirmedRows = items.filter((i) => i.type === "patent_confirmed");
    expect(confirmedRows).toHaveLength(1); // all 25 happened today -> one day-row, not 25
    expect(confirmedRows[0].productName).toBe("25 products");
  });

  it("ignores routine (non-PTA-source) ingestion records — avoids false 'changed' noise on every refresh", async () => {
    const drug = await createDrug({ applicationNumber: "NDA800012" });
    const patent = await prisma.patent.create({
      data: { drugId: drug.id, patentNumber: "P12", nominalExpiryDate: daysFromNow(100), effectiveExpiryDate: daysFromNow(100) },
    });
    const otherSource = await prisma.dataSource.create({ data: { name: "FDA Orange Book" } });
    await prisma.ingestionRecord.create({ data: { sourceId: otherSource.id, patentId: patent.id } });

    const items = await getRecentActivity(50);
    expect(items.some((i) => i.type === "patent_confirmed")).toBe(false);
  });

  it("limit caps the number of items returned", async () => {
    for (let i = 0; i < 3; i++) {
      const drug = await createDrug({ applicationNumber: `NDA80002${i}` });
      await prisma.genericChallenge.create({
        data: {
          naturalKeyNda: `NDA80002${i}`, activeIngredient: "testine", dosageForm: "TABLET", strength: "10MG",
          rldName: "TestDrug", rldNdaNumber: `NDA80002${i}`, submissionDateType: "EXACT_DATE",
          submissionDate: daysFromNow(-i),
          decisionHistory: [], rawStrengthText: "10MG",
          drugLinks: { create: { drugId: drug.id } },
        },
      });
    }
    const items = await getRecentActivity(2);
    expect(items).toHaveLength(2);
  });
});

describe("getActivityPage", () => {
  it("paginates the same sorted feed and reports a total", async () => {
    for (let i = 0; i < 5; i++) {
      const drug = await createDrug({ applicationNumber: `NDA80003${i}` });
      await prisma.genericChallenge.create({
        data: {
          naturalKeyNda: `NDA80003${i}`, activeIngredient: "testine", dosageForm: "TABLET", strength: "10MG",
          rldName: "TestDrug", rldNdaNumber: `NDA80003${i}`, submissionDateType: "EXACT_DATE",
          submissionDate: daysFromNow(-i),
          decisionHistory: [], rawStrengthText: "10MG",
          drugLinks: { create: { drugId: drug.id } },
        },
      });
    }
    const page1 = await getActivityPage(2, 0);
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBeGreaterThanOrEqual(5);

    const page2 = await getActivityPage(2, 2);
    expect(page2.items).toHaveLength(2);
    expect(page1.items.map((i) => i.href)).not.toEqual(page2.items.map((i) => i.href));
  });
});
