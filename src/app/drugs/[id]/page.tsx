import { notFound } from "next/navigation";
import { getDrugById } from "@/lib/drugs/queries";
import { titleCase, formatDate } from "@/lib/format";
import { TypeBadge } from "@/components/drugs/TypeBadge";
import { ModalityBadge } from "@/components/drugs/ModalityBadge";
import { MODALITY_LABELS } from "@/lib/classification/modality";
import { GenericEntryCallout } from "@/components/drugs/GenericEntryCallout";
import { PatentsTable } from "@/components/drugs/PatentsTable";
import { ExclusivitiesTable } from "@/components/drugs/ExclusivitiesTable";
import { BackLink } from "@/components/drugs/BackLink";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DrugDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const drug = await getDrugById(id);

  if (!drug) notFound();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6">
      <BackLink />

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{titleCase(drug.brandName)}</h1>
          <TypeBadge type={drug.applicationType} />
          {drug.modality !== "SMALL_MOLECULE" && (
            <ModalityBadge modality={drug.modality} label={MODALITY_LABELS[drug.modality]} />
          )}
          {drug.drugClass && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 ring-1 ring-inset ring-zinc-500/20 dark:text-zinc-400">
              {drug.drugClass}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {titleCase(drug.genericName)} · {titleCase(drug.dosageForm)} · {titleCase(drug.route)} · {drug.strength}
        </p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {titleCase(drug.company.name)} · {drug.applicationType} {drug.applicationNumber}, product {drug.productNumber}
          {drug.approvalDate && <> · approved {formatDate(drug.approvalDate)}</>}
        </p>
      </div>

      <GenericEntryCallout estimate={drug.genericEntryEstimate} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Patents <span className="font-normal text-zinc-400">({drug.patents.length})</span>
        </h2>
        <PatentsTable patents={drug.patents} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Exclusivities <span className="font-normal text-zinc-400">({drug.exclusivities.length})</span>
        </h2>
        <ExclusivitiesTable exclusivities={drug.exclusivities} />
      </section>
    </div>
  );
}
