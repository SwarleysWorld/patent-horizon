// Pure date math for turning a USPTO filing date + PTA adjustment into an
// effective expiry date. Extracted out of pta/enrich.ts (which mutates an
// *existing* Patent row by id) so src/lib/ingestion/manualEntry can reuse
// the exact same computation for a brand-new Patent that doesn't have a
// row yet — enrichOnePatent itself can't be called for that case, since
// there's no id to update.

export const STATUTORY_TERM_YEARS = 20;
const MS_PER_DAY = 86_400_000;

// UTC-based arithmetic throughout — not `.setDate()`/`.setFullYear()`,
// which read and write the LOCAL calendar date of a Date object. USPTO's
// filingDate ("2001-11-01") parses as UTC midnight (bare ISO date strings
// always do), so mutating it with local-time setters silently shifts the
// result by a day in any timezone west of UTC — caught live: a patent with
// 0 days of PTA adjustment computed an effective date one day EARLIER than
// its own filing date + 20 years, in this server's UTC-6 timezone. Same
// class of bug as the two already fixed in the Purple Book date parser
// (see README's "Notes for future sessions").
export function addDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

// Reissue (and any other non-plain-numeric) patent numbers inherit the
// remaining term of the original patent they reissued from — "filing date
// + 20 years" does not apply to them the way it does for a standard
// utility patent. We can't safely recompute a statutory baseline for these
// without also resolving the original patent's term, so for these we apply
// USPTO's PTA figure as a delta on top of whatever nominal expiry we
// already have, rather than recomputing from scratch.
export function isStandardUtilityPatentNumber(patentNumber: string): boolean {
  return /^[0-9]+$/.test(patentNumber);
}

export function computeStandardEffectiveExpiry(filingDate: Date, ptaDays: number): Date {
  const statutoryNominal = new Date(
    Date.UTC(filingDate.getUTCFullYear() + STATUTORY_TERM_YEARS, filingDate.getUTCMonth(), filingDate.getUTCDate()),
  );
  return addDays(statutoryNominal, ptaDays);
}

export function computeNonStandardEffectiveExpiry(existingNominalExpiry: Date, ptaDays: number): Date {
  return addDays(existingNominalExpiry, ptaDays);
}
