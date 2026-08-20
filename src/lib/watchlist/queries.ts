import { prisma } from "@/lib/prisma";

export type WatchlistTarget = { drugId: string; biologicProductId?: never } | { drugId?: never; biologicProductId: string };

export async function isWatching(userId: string, target: WatchlistTarget): Promise<boolean> {
  const item = await prisma.watchlistItem.findFirst({
    where: { userId, drugId: target.drugId ?? null, biologicProductId: target.biologicProductId ?? null },
    select: { id: true },
  });
  return item !== null;
}

export interface WatchlistProductSummary {
  watchlistItemId: string;
  productType: "drug" | "biologic";
  href: string;
  name: string;
  alternateName: string;
  addedAt: string;
}

export async function getWatchlist(userId: string): Promise<WatchlistProductSummary[]> {
  const items = await prisma.watchlistItem.findMany({
    where: { userId },
    include: {
      drug: { select: { id: true, brandName: true, genericName: true } },
      biologicProduct: { select: { id: true, proprietaryName: true, properName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return items
    .map((item): WatchlistProductSummary | null => {
      if (item.drug) {
        return {
          watchlistItemId: item.id,
          productType: "drug",
          href: `/drugs/${item.drug.id}`,
          name: item.drug.brandName,
          alternateName: item.drug.genericName,
          addedAt: item.createdAt.toISOString().slice(0, 10),
        };
      }
      if (item.biologicProduct) {
        return {
          watchlistItemId: item.id,
          productType: "biologic",
          href: `/biologics/${item.biologicProduct.id}`,
          name: item.biologicProduct.proprietaryName,
          alternateName: item.biologicProduct.properName,
          addedAt: item.createdAt.toISOString().slice(0, 10),
        };
      }
      // Unreachable given the schema's exactly-one-parent CHECK constraint
      // and onDelete: Cascade (a deleted Drug/BiologicProduct takes its
      // WatchlistItem rows with it) — TypeScript just can't see that.
      return null;
    })
    .filter((x): x is WatchlistProductSummary => x !== null);
}
