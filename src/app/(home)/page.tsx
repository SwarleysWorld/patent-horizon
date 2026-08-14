import { listDrugs } from "@/lib/drugs/queries";
import { ListDrugsQuerySchema } from "@/lib/drugs/schemas";
import { DrugsExplorer } from "@/components/drugs/DrugsExplorer";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// A malformed/tampered URL (e.g. someone hand-edits `?limit=99999`) should
// never crash the page for an analyst who's just trying to look at data —
// fall back to defaults instead of surfacing the API's strict 400 here.
function parseSearchParams(raw: Record<string, string | string[] | undefined>) {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") flat[key] = value;
  }
  // The API's own default page size (20) is tuned for a generic consumer;
  // this is a dense professional table, so default larger unless the URL
  // says otherwise.
  const withDefaultLimit = { limit: "50", ...flat };
  const result = ListDrugsQuerySchema.safeParse(withDefaultLimit);
  return result.success ? result.data : ListDrugsQuerySchema.parse({ limit: "50" });
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const query = parseSearchParams(await searchParams);
  const { data, pagination } = await listDrugs(query);

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Upcoming Patent Expirations</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Ranked by estimated generic-entry date — soonest first.
        </p>
      </div>
      <DrugsExplorer data={data} pagination={pagination} />
    </div>
  );
}
