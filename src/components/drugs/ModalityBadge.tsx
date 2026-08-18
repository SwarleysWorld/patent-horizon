import type { Modality } from "@/lib/classification/modality";

const STYLES: Record<Modality, string> = {
  SMALL_MOLECULE: "bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-500/10 dark:text-zinc-400 dark:ring-zinc-500/20",
  PEPTIDE: "bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-500/10 dark:text-teal-400 dark:ring-teal-500/20",
  OLIGONUCLEOTIDE: "bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-indigo-500/20",
  MONOCLONAL_ANTIBODY: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20",
  CELL_THERAPY: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20 dark:bg-fuchsia-500/10 dark:text-fuchsia-400 dark:ring-fuchsia-500/20",
  GENE_THERAPY: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20",
  VACCINE: "bg-cyan-50 text-cyan-700 ring-cyan-600/20 dark:bg-cyan-500/10 dark:text-cyan-400 dark:ring-cyan-500/20",
  OTHER: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20",
  UNCLASSIFIED: "bg-zinc-50 text-zinc-400 ring-zinc-400/20 dark:bg-zinc-500/5 dark:text-zinc-500 dark:ring-zinc-500/10",
};

export function ModalityBadge({ modality, label }: { modality: Modality; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STYLES[modality]}`}
    >
      {label}
    </span>
  );
}
