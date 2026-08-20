const STYLES: Record<string, string> = {
  STANDARD: "bg-ledger-50 text-ledger-700 ring-ledger-600/20 dark:bg-ledger-500/10 dark:text-ledger-400 dark:ring-ledger-500/20",
  BIOSIMILAR: "bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-500/10 dark:text-teal-400 dark:ring-teal-500/20",
  INTERCHANGEABLE: "bg-statute-50 text-statute-700 ring-statute-600/20 dark:bg-statute-500/10 dark:text-statute-400 dark:ring-statute-500/20",
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
