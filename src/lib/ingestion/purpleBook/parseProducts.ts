import type {
  BiologicCenter,
  LicenseType,
  ParsedBiologicExclusivity,
  ParsedBiologicProduct,
  RowIssue,
} from "./types";

// Real, confirmed field names from the July 2026 monthly download header
// row (accessdata.fda.gov/drugsatfda_docs/PurpleBook/...) — see README for
// how this was verified. Parsed by NAME via a header->index map (not fixed
// column position like Orange Book's pipe-delimited files) since FDA's own
// CSV is self-describing and column order is exactly the kind of thing a
// monthly-refreshed government export can silently reorder.
const EXPECTED_HEADER = [
  "N/R/U", "Applicant", "BLA Number", "Proprietary Name", "Proper Name", "License Type",
  "Strength", "Dosage Form", "Route of Administration", "Product Presentation",
  "Marketing Status", "Licensure", "Approval Date", "Inter. Approval Date",
  "Ref. Product Proper Name", "Ref. Product Proprietary Name", "Supplement Number",
  "Submission Type", "Inter. Supplement Number", "License Number", "Product Number",
  "Center", "Date of First Licensure", "Exclusivity Expiration Date",
  "First Interchangeable Exclusivity Exp. Date", "Ref. Product Exclusivity Exp. Date",
  "Orphan Exclusivity Exp. Date", "Patent List Provided",
];

// Real quoted-field CSV (e.g. `"Recombivax, Recombivax Hb"`), unlike Orange
// Book's simple `~`-delimited format — a naive comma-split would break on
// any proprietary name containing a comma. Hand-rolled rather than adding a
// CSV-parsing dependency: the format is plain RFC4180 (quoted fields,
// `""` for an escaped quote), a small, well-understood algorithm.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

function splitLines(content: string): string[] {
  return content.split(/\r\n|\n/).filter((line) => line.length > 0);
}

const TBD_SENTINEL = "date tbd";

// Purple Book dates arrive in two different formats depending on which
// section of the same file they came from — confirmed in the real July
// 2026 download: "July 23, 1986" (long month name, in the change-log
// section) and "15-Jan-74" (day-Mon-2digitYear, in the full-snapshot
// section, which is the one this pipeline actually reads). A 2-digit year
// needs a pivot to resolve the century — checked across all five date
// columns in the real file (not just Approval Date, which was checked
// first and, misleadingly, only goes up to 26): the true range is 00-32
// and 64-99, with a wide, clean gap between them. A first pass used a
// pivot of 30, which is INSIDE that observed 00-32 range and silently
// mis-parsed real future exclusivity dates like Keytruda's "25-Jan-31"
// (meant as 2031, a real future BPCIA reference-product exclusivity date)
// as 1931 — caught by manually sanity-checking a real API response, not
// by the isolated date-range check that produced the original pivot.
// Pivot is 50 now, centered in the actual 33-63 gap with wide margin on
// both sides. Returns null for "Date TBD" (a real, documented sentinel —
// see the Purple Book FAQ on first interchangeable exclusivity) or
// anything else unparseable; callers decide whether that's expected (log
// an issue) or fine (field is legitimately optional).
function parsePurpleBookDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.toLowerCase() === TBD_SENTINEL) return null;

  const shortMatch = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (shortMatch) {
    const [, day, monAbbrev, yy] = shortMatch;
    const monthIndex = "JanFebMarAprMayJunJulAugSepOctNovDec".indexOf(
      monAbbrev.slice(0, 1).toUpperCase() + monAbbrev.slice(1, 3).toLowerCase(),
    );
    if (monthIndex === -1 || monthIndex % 3 !== 0) return null;
    const month = monthIndex / 3;
    const year2 = Number(yy);
    const year = year2 <= 50 ? 2000 + year2 : 1900 + year2;
    const date = new Date(Date.UTC(year, month, Number(day)));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // The long-month-name format ("July 23, 1986") has no explicit timezone,
  // so `new Date(...)` parses it in the SERVER's local timezone — meaning
  // ingestion run in different timezones would silently produce different
  // UTC instants for the same date-only value (caught by a test asserting
  // an exact UTC timestamp, not by the earlier real-data date-range
  // check). Re-anchor to UTC midnight of the same calendar date that was
  // parsed, rather than trusting whatever offset local parsing applied.
  const localParse = new Date(trimmed);
  if (Number.isNaN(localParse.getTime())) return null;
  return new Date(Date.UTC(localParse.getFullYear(), localParse.getMonth(), localParse.getDate()));
}

function parseLicenseType(raw: string): LicenseType | null {
  const trimmed = raw.trim();
  if (trimmed === "351(a)") return "STANDARD";
  if (trimmed === "351(k) Biosimilar") return "BIOSIMILAR";
  if (trimmed === "351(k) Interchangeable") return "INTERCHANGEABLE";
  return null;
}

function parseCenter(raw: string): BiologicCenter | null {
  const trimmed = raw.trim().toUpperCase();
  return trimmed === "CDER" || trimmed === "CBER" ? trimmed : null;
}

function blaProductKey(blaNumber: string, productNumber: string): string {
  return `${blaNumber}::${productNumber}`;
}

// "N/A" is Purple Book's own sentinel for "no reference product" on a
// 351(a) row (confirmed in the real data) — distinct from a genuinely
// empty string, but treated the same way here (both mean "no reference
// product name given").
function cleanRefName(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.toUpperCase() === "N/A") return null;
  return trimmed;
}

export function parseProductsCsv(content: string): {
  products: ParsedBiologicProduct[];
  exclusivities: ParsedBiologicExclusivity[];
  rawCount: number;
  issues: RowIssue[];
} {
  const issues: RowIssue[] = [];
  const lines = splitLines(content);

  // The monthly download has two sections separated by a repeated header
  // row: a change-log section, then the full current snapshot. We want
  // only the full snapshot — find the LAST occurrence of the header and
  // parse everything after it (see README for the file's actual layout).
  const headerLineIndexes = lines
    .map((line, i) => (parseCsvLine(line)[0] === "N/R/U" ? i : -1))
    .filter((i) => i !== -1);

  if (headerLineIndexes.length === 0) {
    issues.push({ file: "products.csv", line: 1, reason: "no header row found (expected a row starting \"N/R/U\")", raw: "" });
    return { products: [], exclusivities: [], rawCount: 0, issues };
  }

  const lastHeaderIndex = headerLineIndexes[headerLineIndexes.length - 1];
  const header = parseCsvLine(lines[lastHeaderIndex]);
  if (header.length !== EXPECTED_HEADER.length || EXPECTED_HEADER.some((col, i) => header[i] !== col)) {
    issues.push({
      file: "products.csv",
      line: lastHeaderIndex + 1,
      reason: `header columns differ from what this pipeline expects — source format may have changed. Got: ${header.join(" | ")}`,
      raw: lines[lastHeaderIndex],
    });
  }
  const col = (name: string) => header.indexOf(name);

  const dataLines = lines.slice(lastHeaderIndex + 1);
  const products: ParsedBiologicProduct[] = [];
  const exclusivities: ParsedBiologicExclusivity[] = [];

  dataLines.forEach((line, idx) => {
    const lineNo = lastHeaderIndex + 2 + idx; // 1-indexed, relative to the whole file
    const fields = parseCsvLine(line);
    const raw = line;
    const get = (name: string) => (fields[col(name)] ?? "").trim();

    if (fields.length < EXPECTED_HEADER.length) {
      issues.push({
        file: "products.csv",
        line: lineNo,
        reason: `expected ${EXPECTED_HEADER.length} fields, got ${fields.length}`,
        raw,
      });
      return;
    }

    const blaNumber = get("BLA Number");
    const productNumber = get("Product Number");
    const proprietaryName = get("Proprietary Name");
    const properName = get("Proper Name");
    const companyName = get("Applicant");

    if (!blaNumber || !productNumber || !proprietaryName || !properName || !companyName) {
      issues.push({
        file: "products.csv",
        line: lineNo,
        reason: "empty BLA Number, Product Number, Proprietary Name, Proper Name, or Applicant",
        raw,
      });
      return;
    }

    const licenseType = parseLicenseType(get("License Type"));
    if (!licenseType) {
      issues.push({
        file: "products.csv",
        line: lineNo,
        reason: `unrecognized License Type "${get("License Type")}" (expected 351(a), 351(k) Biosimilar, or 351(k) Interchangeable)`,
        raw,
      });
      return;
    }

    const center = parseCenter(get("Center"));
    if (!center) {
      issues.push({
        file: "products.csv",
        line: lineNo,
        reason: `unrecognized Center "${get("Center")}" (expected CDER or CBER)`,
        raw,
      });
      return;
    }

    const key = blaProductKey(blaNumber, productNumber);

    products.push({
      blaProductKey: key,
      blaNumber,
      productNumber,
      companyName,
      proprietaryName,
      properName,
      licenseType,
      center,
      dosageForm: get("Dosage Form"),
      route: get("Route of Administration"),
      strength: get("Strength"),
      marketingStatus: get("Marketing Status") || null,
      approvalDate: parsePurpleBookDate(get("Approval Date")),
      referenceProductProprietaryNameRaw: cleanRefName(get("Ref. Product Proprietary Name")),
      referenceProductProperNameRaw: cleanRefName(get("Ref. Product Proper Name")),
    });

    // Up to three distinct BPCIA exclusivity mechanisms per row — see
    // types.ts. The legacy "Exclusivity Expiration Date" column is
    // deliberately not read: confirmed 0/2,230 filled in the real July
    // 2026 data (vestigial), and superseded by the three specific columns
    // below.
    const refProductExpRaw = get("Ref. Product Exclusivity Exp. Date");
    const refProductExp = parsePurpleBookDate(refProductExpRaw);
    if (refProductExp) {
      exclusivities.push({ blaProductKey: key, code: "BPCIA_REF_PRODUCT", expirationDate: refProductExp });
    } else if (refProductExpRaw.trim()) {
      issues.push({ file: "products.csv", line: lineNo, reason: `unparseable Ref. Product Exclusivity Exp. Date "${refProductExpRaw}"`, raw });
    }

    const firstInterchangeableRaw = get("First Interchangeable Exclusivity Exp. Date");
    const firstInterchangeable = parsePurpleBookDate(firstInterchangeableRaw);
    if (firstInterchangeable) {
      exclusivities.push({ blaProductKey: key, code: "BPCIA_FIRST_INTERCHANGEABLE", expirationDate: firstInterchangeable });
    } else if (firstInterchangeableRaw.trim() && firstInterchangeableRaw.trim().toLowerCase() !== TBD_SENTINEL) {
      issues.push({ file: "products.csv", line: lineNo, reason: `unparseable First Interchangeable Exclusivity Exp. Date "${firstInterchangeableRaw}"`, raw });
    }
    // "Date TBD" is expected and NOT logged as an issue: FDA has determined
    // eligibility but not yet the period — this is documented, common
    // behavior, not a data-quality problem (see the Purple Book FAQ).

    const orphanRaw = get("Orphan Exclusivity Exp. Date");
    const orphan = parsePurpleBookDate(orphanRaw);
    if (orphan) {
      exclusivities.push({ blaProductKey: key, code: "ORPHAN", expirationDate: orphan });
    } else if (orphanRaw.trim()) {
      issues.push({ file: "products.csv", line: lineNo, reason: `unparseable Orphan Exclusivity Exp. Date "${orphanRaw}"`, raw });
    }
  });

  return { products, exclusivities, rawCount: dataLines.length, issues };
}
