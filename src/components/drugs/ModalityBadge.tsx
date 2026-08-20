import type { Modality } from "@/lib/classification/modality";

const STYLES: Record<Modality, string> = {
  SMALL_MOLECULE: "bg-paper-100 text-paper-600 ring-paper-500/20 dark:bg-paper-500/10 dark:text-paper-400 dark:ring-paper-500/20",
  PEPTIDE: "bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-500/10 dark:text-teal-400 dark:ring-teal-500/20",
  OLIGONUCLEOTIDE: "bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-indigo-500/20",
  MONOCLONAL_ANTIBODY: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20",
  CELL_THERAPY: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20 dark:bg-fuchsia-500/10 dark:text-fuchsia-400 dark:ring-fuchsia-500/20",
  GENE_THERAPY: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20",
  VACCINE: "bg-cyan-50 text-cyan-700 ring-cyan-600/20 dark:bg-cyan-500/10 dark:text-cyan-400 dark:ring-cyan-500/20",
  OTHER: "bg-flag-50 text-flag-700 ring-flag-600/20 dark:bg-flag-500/10 dark:text-flag-400 dark:ring-flag-500/20",
  UNCLASSIFIED: "bg-paper-50 text-paper-400 ring-paper-400/20 dark:bg-paper-500/5 dark:text-paper-500 dark:ring-paper-500/10",
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
