import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./helpers";
import { isWatching, getWatchlist } from "@/lib/watchlist/queries";

let companyId: string;
let userId: string;

beforeEach(async () => {
  await resetDb();
  const company = await prisma.company.create({ data: { name: "Acme Pharma" } });
  companyId = company.id;
  const user = await prisma.user.create({
    data: { id: "test-user-1", name: "Test User", email: "watchlist-test@example.com", role: "user" },
  });
  userId = user.id;
});

async function createDrug(applicationNumber: string) {
  return prisma.drug.create({
    data: {
      companyId,
      brandName: "TestDrug",
      genericName: "testine",
      applicationType: "NDA",
      applicationNumber,
      productNumber: "001",
      dosageForm: "TABLET",
      route: "ORAL",
      strength: "10MG",
    },
  });
}

async function createBiologic(blaNumber: string) {
  return prisma.biologicProduct.create({
    data: {
      companyId,
      blaNumber,
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
}

describe("isWatching", () => {
  it("is false when nothing is watched", async () => {
    const drug = await createDrug("NDA700001");
    expect(await isWatching(userId, { drugId: drug.id })).toBe(false);
  });

  it("is true once a WatchlistItem exists for that drug", async () => {
    const drug = await createDrug("NDA700002");
    await prisma.watchlistItem.create({ data: { userId, drugId: drug.id } });
    expect(await isWatching(userId, { drugId: drug.id })).toBe(true);
  });

  it("distinguishes users — one user's watch doesn't show for another", async () => {
    const drug = await createDrug("NDA700003");
    await prisma.watchlistItem.create({ data: { userId, drugId: drug.id } });
    expect(await isWatching("some-other-user", { drugId: drug.id })).toBe(false);
  });

  it("works for a biologic product too", async () => {
    const bio = await createBiologic("BLA7001");
    await prisma.watchlistItem.create({ data: { userId, biologicProductId: bio.id } });
    expect(await isWatching(userId, { biologicProductId: bio.id })).toBe(true);
  });
});

describe("getWatchlist", () => {
  it("lists watched drugs and biologics together, most-recently-added first", async () => {
    const drug = await createDrug("NDA700004");
    const bio = await createBiologic("BLA7002");
    await prisma.watchlistItem.create({ data: { userId, drugId: drug.id } });
    await prisma.watchlistItem.create({ data: { userId, biologicProductId: bio.id } });

    const items = await getWatchlist(userId);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.productType).sort()).toEqual(["biologic", "drug"]);
    expect(items.find((i) => i.productType === "drug")).toMatchObject({ href: `/drugs/${drug.id}`, name: "TestDrug" });
    expect(items.find((i) => i.productType === "biologic")).toMatchObject({ href: `/biologics/${bio.id}`, name: "TestBio" });
  });

  it("is empty for a user with nothing watched", async () => {
    expect(await getWatchlist(userId)).toEqual([]);
  });
});
