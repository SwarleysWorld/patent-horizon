"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import type { WatchlistTarget } from "@/lib/watchlist/queries";

// A Server Action is a public endpoint in its own right, reachable
// directly and not just via the button it's wired to — re-verify the
// caller here rather than trusting that the page that rendered the
// button already gated on requireUser() (same reasoning as
// src/app/team/actions.ts).
export async function toggleWatchlistAction(target: WatchlistTarget, currentPath: string): Promise<{ watching: boolean }> {
  const user = await requireUser();

  const where = target.drugId
    ? { userId_drugId: { userId: user.id, drugId: target.drugId } }
    : { userId_biologicProductId: { userId: user.id, biologicProductId: target.biologicProductId! } };

  const existing = await prisma.watchlistItem.findUnique({ where });

  let watching: boolean;
  if (existing) {
    await prisma.watchlistItem.delete({ where: { id: existing.id } });
    watching = false;
  } else {
    await prisma.watchlistItem.create({ data: { userId: user.id, ...target } });
    watching = true;
  }

  revalidatePath(currentPath);
  revalidatePath("/watchlist");
  return { watching };
}
