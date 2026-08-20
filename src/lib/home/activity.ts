import { prisma } from "@/lib/prisma";
import { getExpiryHorizonCounts } from "@/lib/drugs/queries";
import { PTA_SOURCE_NAME } from "@/lib/ingestion/pta/enrich";

// ---- Portfolio stats (the 4 stat tiles) ---------------------------------

export interface PortfolioStats {
  totalTracked: number;
  within30Days: number;
  within90Days: number;
  within365Days: number;
  activeChallenges: number;
  /** Drugs where a linked generic challenge shows real commercial marketing predating the computed expiry — the app's clearest "this already happened" signal. */
  divergenceCount: number;
}

export async function getPortfolioStats(): Promise<PortfolioStats> {
  const [drugCount, biologicCount, horizons, activeChallenges, divergenceRows] = await Promise.all([
    prisma.drug.count(),
    prisma.biologicProduct.count(),
    getExpiryHorizonCounts(),
    // "Active" = not yet resolved to EXTINGUISHED (includes the common
    // case of no decision at all — currentStatus null — since an
    // undecided challenge is still very much live).
    prisma.genericChallenge.count({
      where: { OR: [{ currentStatus: null }, { currentStatus: { in: ["ELIGIBLE", "DEFERRED", "NON_FORFEITURE"] } }] },
    }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(DISTINCT gcd."drugId") AS count
      FROM "GenericChallengeDrug" gcd
      JOIN "GenericChallenge" gc ON gc.id = gcd."genericChallengeId"
      JOIN "Drug" d ON d.id = gcd."drugId"
      LEFT JOIN "Patent" p ON p."drugId" = d.id AND p."delistedAt" IS NULL
      LEFT JOIN "Exclusivity" e ON e."drugId" = d.id
      WHERE gc."dateOfFirstCommercialMarketing" IS NOT NULL
      GROUP BY d.id, gc."dateOfFirstCommercialMarketing"
      HAVING gc."dateOfFirstCommercialMarketing" < GREATEST(MAX(p."effectiveExpiryDate"), MAX(e."expirationDate"))
    `,
  ]);

  return {
    totalTracked: drugCount + biologicCount,
    within30Days: horizons.within30,
    within90Days: horizons.within90,
    within365Days: horizons.within365,
    activeChallenges,
    divergenceCount: divergenceRows.length,
  };
}

// ---- Recent activity feed -----------------------------------------------
//
// Every item's `date` is a real date FROM THE SOURCE DATA (when the
// underlying event actually happened, per FDA), never our own ingestion
// timestamp — a first attempt at this used createdAt/updatedAt for two of
// the four event types, which meant every item showed the same date after
// a single bulk ingestion run (the date we loaded it, not when it
// happened). The one deliberate exception is `patent_confirmed`: a PTA
// enrichment run doesn't correspond to a dated event in USPTO's data the
// way a filing or a posted decision does — the confirmation itself, dated
// by when we verified it, IS the activity for that item type.

export type ActivityType = "new_challenge" | "decision_posted" | "marketing_recorded" | "patent_confirmed";

export interface ActivityItem {
  type: ActivityType;
  date: string; // ISO date — always a real event date from the source, except patent_confirmed (see above)
  href: string;
  productName: string;
  detail: string;
}

const STATUS_LABELS: Record<string, string> = {
  ELIGIBLE: "Eligible",
  DEFERRED: "Deferred",
  NON_FORFEITURE: "Non-Forfeiture",
  EXTINGUISHED: "Extinguished",
};

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function firstLinkedDrug<T extends { drugLinks: { drug: { id: string; brandName: string } }[] }>(
  challenge: T,
): { id: string; brandName: string } | null {
  return challenge.drugLinks[0]?.drug ?? null;
}

// Pool size per category before merging — generous enough that "recent"
// across all four types together is still accurate after the merge, without
// pulling every row in the database into memory to sort.
const POOL_SIZE = 300;

// Max number of day-level patent_confirmed summary rows (see
// patentTermsConfirmed below) — plenty generous for "recent," since this
// is one row per day a PTA run happened, not one row per patent.
const PATENT_CONFIRMED_CAP = 15;

async function filedChallenges(): Promise<ActivityItem[]> {
  const rows = await prisma.genericChallenge.findMany({
    where: { submissionDate: { not: null }, drugLinks: { some: {} } },
    include: { drugLinks: { include: { drug: { select: { id: true, brandName: true } } }, take: 1 } },
    orderBy: { submissionDate: "desc" },
    take: POOL_SIZE,
  });
  return rows
    .map((c): ActivityItem | null => {
      const drug = firstLinkedDrug(c);
      if (!drug || !c.submissionDate) return null;
      return {
        type: "new_challenge",
        date: toIsoDate(c.submissionDate),
        href: `/drugs/${drug.id}`,
        productName: drug.brandName,
        detail: `Generic challenge filed against ${c.rldName} (${c.activeIngredient})`,
      };
    })
    .filter((x): x is ActivityItem => x !== null);
}

async function postedDecisions(): Promise<ActivityItem[]> {
  // decisionHistory[0].postingDate isn't a plain column, so this can't be
  // ordered/limited in SQL — fetch every challenge with at least one
  // decision (a small subset of the total) and sort in JS instead.
  const rows = await prisma.genericChallenge.findMany({
    where: { drugLinks: { some: {} }, currentStatus: { not: null } },
    include: { drugLinks: { include: { drug: { select: { id: true, brandName: true } } }, take: 1 } },
  });
  const items: ActivityItem[] = [];
  for (const c of rows) {
    const history = c.decisionHistory as unknown as { status: string; postingDate: string | null }[];
    const latest = history[0];
    if (!latest?.postingDate) continue;
    const drug = firstLinkedDrug(c);
    if (!drug) continue;
    items.push({
      type: "decision_posted",
      date: latest.postingDate,
      href: `/drugs/${drug.id}`,
      productName: drug.brandName,
      detail: `180-day exclusivity decision posted: ${STATUS_LABELS[latest.status] ?? latest.status}`,
    });
  }
  return items.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, POOL_SIZE);
}

async function recordedMarketing(): Promise<ActivityItem[]> {
  const rows = await prisma.genericChallenge.findMany({
    where: { dateOfFirstCommercialMarketing: { not: null }, drugLinks: { some: {} } },
    include: { drugLinks: { include: { drug: { select: { id: true, brandName: true } } }, take: 1 } },
    orderBy: { dateOfFirstCommercialMarketing: "desc" },
    take: POOL_SIZE,
  });
  return rows
    .map((c): ActivityItem | null => {
      const drug = firstLinkedDrug(c);
      if (!drug || !c.dateOfFirstCommercialMarketing) return null;
      return {
        type: "marketing_recorded",
        date: toIsoDate(c.dateOfFirstCommercialMarketing),
        href: `/drugs/${drug.id}`,
        productName: drug.brandName,
        detail: `First commercial marketing began ${toIsoDate(c.dateOfFirstCommercialMarketing)}`,
      };
    })
    .filter((x): x is ActivityItem => x !== null);
}

// Deliberately scoped to PTA-source IngestionRecords specifically, not
// "any recently-touched patent" — routine Orange/Purple Book re-
// ingestion re-verifies thousands of already-correct rows on every
// refresh with no real change, which would drown this feed in false
// "changed" signals. PTA enrichment is a genuine provisional->confirmed
// transition (expiryAdjustmentDays going from null to a real number).
//
// Grouped into one summary row PER DAY, not one row per patent — a single
// enrichment run can confirm hundreds of patents in one pass (confirmed
// real: 203 in one run, all sharing that day's date). Listed individually,
// those would sort ahead of every other category's items — none of which
// can ever be dated "today" as often, since a filing/decision/marketing
// date is a real regulatory event, not a batch job — and permanently bury
// the more individually-interesting activity types at the top of the
// feed. One row per day keeps this category present as a real signal
// ("data got fresher") without letting its natural batch volume dominate
// a feed about products, not pipeline runs.
async function patentTermsConfirmed(): Promise<ActivityItem[]> {
  const source = await prisma.dataSource.findUnique({ where: { name: PTA_SOURCE_NAME } });
  if (!source) return [];

  const records = await prisma.ingestionRecord.findMany({
    where: { sourceId: source.id, patentId: { not: null } },
    include: { patent: { select: { expiryAdjustmentDays: true, drugId: true, biologicProductId: true } } },
    orderBy: { createdAt: "desc" },
    take: 5000, // covers several real batches' worth of individual records; collapses to a handful of day-rows below
  });

  const productIdsByDay = new Map<string, Set<string>>();
  for (const r of records) {
    const p = r.patent;
    const productId = p?.drugId ?? p?.biologicProductId;
    if (!p || p.expiryAdjustmentDays === null || !productId) continue;
    const day = toIsoDate(r.createdAt);
    if (!productIdsByDay.has(day)) productIdsByDay.set(day, new Set());
    productIdsByDay.get(day)!.add(productId);
  }

  return [...productIdsByDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, PATENT_CONFIRMED_CAP)
    .map(([day, productIds]): ActivityItem => ({
      type: "patent_confirmed",
      date: day,
      // No single product to link to for a day-level summary — points
      // at the PTA-gap-sorted search instead, which every tier can open
      // (unlike /data, Analyst-only) and is exactly what this event
      // means: patents whose adjustment is now verified.
      href: "/drugs?sort=pta_gap_desc",
      productName: `${productIds.size.toLocaleString()} product${productIds.size === 1 ? "" : "s"}`,
      detail: "Patent terms confirmed against USPTO records",
    }));
}

async function allActivitySortedDesc(): Promise<ActivityItem[]> {
  const [filed, decisions, marketing, confirmed] = await Promise.all([
    filedChallenges(),
    postedDecisions(),
    recordedMarketing(),
    patentTermsConfirmed(),
  ]);
  return [...filed, ...decisions, ...marketing, ...confirmed].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Home page: just the most recent handful. */
export async function getRecentActivity(limit = 5): Promise<ActivityItem[]> {
  return (await allActivitySortedDesc()).slice(0, limit);
}

/** Full activity page: the same feed, paginated — see allActivitySortedDesc for the pool-size bound. */
export async function getActivityPage(limit: number, offset: number): Promise<{ items: ActivityItem[]; total: number }> {
  const all = await allActivitySortedDesc();
  return { items: all.slice(offset, offset + limit), total: all.length };
}
