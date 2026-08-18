import Link from "next/link";
import { notFound } from "next/navigation";
import { getBiologicById } from "@/lib/drugs/queries";
import { titleCase, formatDate } from "@/lib/format";
import { LicenseTypeBadge } from "@/components/drugs/LicenseTypeBadge";
import { SourceBadge } from "@/components/drugs/SourceBadge";
import { ModalityBadge } from "@/components/drugs/ModalityBadge";
import { MODALITY_LABELS } from "@/lib/classification/modality";
import { GenericEntryCallout } from "@/components/drugs/GenericEntryCallout";
import { PatentsTable } from "@/components/drugs/PatentsTable";
import { ExclusivitiesTable } from "@/components/drugs/ExclusivitiesTable";
import { BackLink } from "@/components/drugs/BackLink";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function BiologicDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const biologic = await getBiologicById(id);

  if (!biologic) notFound();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6">
      <BackLink />

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{titleCase(biologic.proprietaryName)}</h1>
          <LicenseTypeBadge licenseType={biologic.licenseType} />
          <SourceBadge source="purple_book" />
          {biologic.modality !== "SMALL_MOLECULE" && biologic.modality !== "UNCLASSIFIED" && (
            <ModalityBadge modality={biologic.modality} label={MODALITY_LABELS[biologic.modality]} />
          )}
          {biologic.drugClass && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 ring-1 ring-inset ring-zinc-500/20 dark:text-zinc-400">
              {biologic.drugClass}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {titleCase(biologic.properName)} · {titleCase(biologic.dosageForm)} · {titleCase(biologic.route)} · {biologic.strength}
        </p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {titleCase(biologic.company.name)} · {biologic.center} · BLA {biologic.blaNumber}, product {biologic.productNumber}
          {biologic.approvalDate && <> · approved {formatDate(biologic.approvalDate)}</>}
        </p>

        {(biologic.referenceProduct || biologic.referenceProductNameRaw) && (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            References:{" "}
            {biologic.referenceProduct ? (
              <Link href={`/biologics/${biologic.referenceProduct.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                {titleCase(biologic.referenceProduct.proprietaryName)}
              </Link>
            ) : (
              <span title="Could not be matched to a specific product on file">
                {titleCase(biologic.referenceProductNameRaw!)} <span className="text-xs text-zinc-400">(unresolved)</span>
              </span>
            )}
          </p>
        )}

        {biologic.biosimilarsAndInterchangeables.length > 0 && (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Reference product for:{" "}
            {biologic.biosimilarsAndInterchangeables.map((b, i) => (
              <span key={b.id}>
                {i > 0 && ", "}
                <Link href={`/biologics/${b.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                  {titleCase(b.proprietaryName)}
                </Link>
              </span>
            ))}
          </p>
        )}
      </div>

      <GenericEntryCallout estimate={biologic.genericEntryEstimate} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Patents <span className="font-normal text-zinc-400">({biologic.patents.length})</span>
        </h2>
        {biologic.patents.length === 0 && (
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            No patents disclosed for this product. FDA&apos;s Purple Book patent list only covers biologics that have
            had a 351(k) biosimilar patent-dance disclosure — most licensed biologics have none on file, which is a
            real data-availability limit, not necessarily an indication there are no patents.
          </p>
        )}
        <PatentsTable patents={biologic.patents} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Exclusivities <span className="font-normal text-zinc-400">({biologic.exclusivities.length})</span>
        </h2>
        <ExclusivitiesTable exclusivities={biologic.exclusivities} />
      </section>
    </div>
  );
}
