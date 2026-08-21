const MS_PER_DAY = 86_400_000;

/** Days from today (UTC midnight) to the given YYYY-MM-DD date string. Negative = in the past. */
export function daysFromToday(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00Z`).getTime();
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - todayUtc) / MS_PER_DAY);
}

/** "Aug 24, 2031" — unambiguous, matches how dates are conventionally shown in professional tools. */
export function formatDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** SEC EDGAR's full-text search `display_names` field appends " (TICKER)  (CIK 0000885590)" to the filer's real name — stripped for prose display; the raw value (with this suffix) is still what's stored on SettlementDisclosure.filingCompanyNameRaw for traceability. */
export function cleanEdgarFilerName(name: string): string {
  return name.replace(/\s*\([A-Z0-9.]{1,10}\)\s*\(CIK\s*\d+\)\s*$/i, "").trim();
}

/** "in 12 days", "in 8 months", "in 5 years", "23 days ago", "Today". */
export function formatRelativeDays(days: number): string {
  if (days === 0) return "Today";
  const abs = Math.abs(days);
  const future = days > 0;

  let text: string;
  if (abs < 60) {
    text = `${abs} day${abs === 1 ? "" : "s"}`;
  } else if (abs < 730) {
    const months = Math.round(abs / 30.44);
    text = `${months} month${months === 1 ? "" : "s"}`;
  } else {
    const years = Math.round(abs / 365.25);
    text = `${years} year${years === 1 ? "" : "s"}`;
  }

  return future ? `in ${text}` : `${text} ago`;
}

export type Urgency = "open" | "imminent" | "upcoming" | "distant";

/** Traffic-light bucket for an estimated generic-entry date, by days out. */
export function urgencyOf(days: number): Urgency {
  if (days <= 0) return "open";
  if (days <= 180) return "imminent";
  if (days <= 730) return "upcoming";
  return "distant";
}

// Orange Book source data arrives ALL CAPS (both brand/generic names and
// applicant names) — authentic to the source, but a wall of caps is
// measurably harder to scan quickly than mixed case. Display-only
// transform; never applied to data that round-trips back into a filter.
export function titleCase(input: string): string {
  return input.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
}
