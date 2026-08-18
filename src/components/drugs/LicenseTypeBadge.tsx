const STYLES: Record<string, string> = {
  STANDARD: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20",
  BIOSIMILAR: "bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-500/10 dark:text-teal-400 dark:ring-teal-500/20",
  INTERCHANGEABLE: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20",
};

const LABELS: Record<string, string> = {
  STANDARD: "351(a)",
  BIOSIMILAR: "Biosimilar",
  INTERCHANGEABLE: "Interchangeable",
};

export function LicenseTypeBadge({ licenseType }: { licenseType: string }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STYLES[licenseType] ?? STYLES.STANDARD}`}>
      {LABELS[licenseType] ?? licenseType}
    </span>
  );
}
