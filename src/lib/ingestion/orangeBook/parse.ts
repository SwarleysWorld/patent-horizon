import type {
  ParsedExclusivity,
  ParsedPatent,
  ParsedProduct,
  ParseResult,
  RowIssue,
} from "./types";

// FDA's own field docs describe this as a special sentinel string, not a
// date, for products approved before the Orange Book existed.
const PRE_1982_SENTINEL = "approved prior to jan 1, 1982";

function splitLines(content: string): string[] {
  return content.split(/\r\n|\n/).filter((line) => line.length > 0);
}

// Dates arrive as "Mmm D, YYYY" (e.g. "Aug 24, 2026"). Returns null for the
// pre-1982 sentinel or anything unparseable — callers decide whether null
// is acceptable for that field.
function parseObDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.toLowerCase() === PRE_1982_SENTINEL) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseYFlag(raw: string): boolean {
  return raw.trim().toUpperCase() === "Y";
}

function drugKey(applicationNumber: string, productNumber: string): string {
  return `${applicationNumber}::${productNumber}`;
}

function parseDelimited(
  content: string,
  expectedFields: number,
  file: RowIssue["file"],
  issues: RowIssue[],
): { rows: string[][]; totalDataLines: number } {
  const lines = splitLines(content);
  if (lines.length === 0) return { rows: [], totalDataLines: 0 };
  const [header, ...dataLines] = lines;
  const headerFields = header.split("~");
  if (headerFields.length !== expectedFields) {
    issues.push({
      file,
      line: 1,
      reason: `header has ${headerFields.length} columns, expected ${expectedFields} — source format may have changed`,
      raw: header,
    });
  }
  const rows: string[][] = [];
  for (const line of dataLines) {
    rows.push(line.split("~"));
  }
  return { rows, totalDataLines: dataLines.length };
}

function parseProducts(content: string, issues: RowIssue[]): { products: ParsedProduct[]; rawCount: number } {
  const { rows, totalDataLines } = parseDelimited(content, 14, "products.txt", issues);
  const products: ParsedProduct[] = [];

  rows.forEach((fields, idx) => {
    const lineNo = idx + 2; // +1 for header, +1 for 1-indexing
    const raw = fields.join("~");

    if (fields.length !== 14) {
      issues.push({
        file: "products.txt",
        line: lineNo,
        reason: `expected 14 fields, got ${fields.length}`,
        raw,
      });
      return;
    }

    const [
      ingredient,
      dfRoute,
      tradeName,
      ,
      strength,
      applType,
      applNo,
      productNo,
      ,
      approvalDateRaw,
      ,
      ,
      ,
      applicantFullName,
    ] = fields;

    const applicationType = applType.trim() === "N" ? "NDA" : applType.trim() === "A" ? "ANDA" : null;
    if (!applicationType) {
      issues.push({
        file: "products.txt",
        line: lineNo,
        reason: `unrecognized Appl_Type "${applType}" (expected N or A)`,
        raw,
      });
      return;
    }

    const dfRouteParts = dfRoute.split(";");
    if (dfRouteParts.length !== 2 || !dfRouteParts[0].trim() || !dfRouteParts[1].trim()) {
      issues.push({
        file: "products.txt",
        line: lineNo,
        reason: `could not split "DF;Route" field "${dfRoute}" into dosage form + route`,
        raw,
      });
      return;
    }

    const companyName = applicantFullName.trim();
    if (!companyName) {
      issues.push({
        file: "products.txt",
        line: lineNo,
        reason: "empty Applicant_Full_Name",
        raw,
      });
      return;
    }

    const applNoTrimmed = applNo.trim();
    const productNoTrimmed = productNo.trim();
    if (!applNoTrimmed || !productNoTrimmed) {
      issues.push({
        file: "products.txt",
        line: lineNo,
        reason: "empty Appl_No or Product_No",
        raw,
      });
      return;
    }

    const applicationNumber = `${applicationType}${applNoTrimmed}`;

    products.push({
      brandName: tradeName.trim(),
      genericName: ingredient.trim(),
      companyName,
      applicationType,
      applicationNumber,
      productNumber: productNoTrimmed,
      dosageForm: dfRouteParts[0].trim(),
      route: dfRouteParts[1].trim(),
      strength: strength.trim(),
      approvalDate: parseObDate(approvalDateRaw),
      drugKey: drugKey(applicationNumber, productNoTrimmed),
    });
  });

  return { products, rawCount: totalDataLines };
}

// Orange Book represents pediatric-exclusivity-extended patents as a
// SECOND row for the same patent: the base row (e.g. patent "8573209",
// expiring on the un-extended date) plus a sibling row (e.g.
// "8573209*PED", expiring ~6 months later). Both rows share the same
// (Appl_No, Product_No, base patent number, Use_Code) key. We group by
// that key and merge the pair into one Patent record: the plain row's
// date becomes nominalExpiryDate, the *PED row's date (if present)
// becomes effectiveExpiryDate.
interface RawPatentRow {
  applicationNumber: string;
  productNumber: string;
  patentNumberRaw: string;
  expireDateRaw: string;
  drugSubstanceFlag: string;
  drugProductFlag: string;
  useCodeRaw: string;
  submittedDateRaw: string;
  lineNo: number;
  raw: string;
}

function parsePatents(content: string, issues: RowIssue[]): { patents: ParsedPatent[]; rawCount: number } {
  const { rows, totalDataLines } = parseDelimited(content, 10, "patent.txt", issues);
  const rawRows: RawPatentRow[] = [];

  rows.forEach((fields, idx) => {
    const lineNo = idx + 2;
    const raw = fields.join("~");

    if (fields.length !== 10) {
      issues.push({
        file: "patent.txt",
        line: lineNo,
        reason: `expected 10 fields, got ${fields.length}`,
        raw,
      });
      return;
    }

    const [
      applType,
      applNo,
      productNo,
      patentNo,
      expireDate,
      substanceFlag,
      productFlag,
      useCode,
      ,
      submittedDate,
    ] = fields;

    const applicationType = applType.trim() === "N" ? "NDA" : applType.trim() === "A" ? "ANDA" : null;
    if (!applicationType) {
      issues.push({
        file: "patent.txt",
        line: lineNo,
        reason: `unrecognized Appl_Type "${applType}" (expected N or A)`,
        raw,
      });
      return;
    }

    const applNoTrimmed = applNo.trim();
    const productNoTrimmed = productNo.trim();
    if (!applNoTrimmed || !productNoTrimmed || !patentNo.trim()) {
      issues.push({
        file: "patent.txt",
        line: lineNo,
        reason: "empty Appl_No, Product_No, or Patent_No",
        raw,
      });
      return;
    }

    rawRows.push({
      applicationNumber: `${applicationType}${applNoTrimmed}`,
      productNumber: productNoTrimmed,
      patentNumberRaw: patentNo.trim(),
      expireDateRaw: expireDate,
      drugSubstanceFlag: substanceFlag,
      drugProductFlag: productFlag,
      useCodeRaw: useCode,
      submittedDateRaw: submittedDate,
      lineNo,
      raw,
    });
  });

  // Group by (drugKey, base patent number, use code).
  const groups = new Map<
    string,
    { plain?: RawPatentRow; ped?: RawPatentRow; others: RawPatentRow[] }
  >();

  for (const row of rawRows) {
    const [base, ...markerParts] = row.patentNumberRaw.split("*");
    const marker = markerParts.join("*"); // preserve if there were multiple '*' (shouldn't happen)
    if (marker && marker !== "PED") {
      issues.push({
        file: "patent.txt",
        line: row.lineNo,
        reason: `patent number "${row.patentNumberRaw}" has unrecognized suffix "*${marker}" (expected *PED or none) — keeping base number, dropping marker`,
        raw: row.raw,
      });
    }

    const useCode = row.useCodeRaw.trim(); // "" sentinel for "no use code"
    const key = `${drugKey(row.applicationNumber, row.productNumber)}::${base}::${useCode}`;

    const group = groups.get(key) ?? { others: [] };
    if (marker === "PED") {
      if (group.ped) group.others.push(row);
      else group.ped = row;
    } else {
      if (group.plain) group.others.push(row);
      else group.plain = row;
    }
    groups.set(key, group);
  }

  const patents: ParsedPatent[] = [];

  for (const [key, group] of groups) {
    if (group.others.length > 0) {
      issues.push({
        file: "patent.txt",
        line: group.others[0].lineNo,
        reason: `patent group "${key}" had ${group.others.length} extra row(s) beyond one plain + one *PED row; extras were ignored`,
        raw: group.others.map((r) => r.raw).join(" | "),
      });
    }

    const anchor = group.plain ?? group.ped;
    if (!anchor) continue; // unreachable, but keeps TS/logic honest

    const nominalDate = group.plain ? parseObDate(group.plain.expireDateRaw) : null;
    const pedDate = group.ped ? parseObDate(group.ped.expireDateRaw) : null;

    if (group.plain && !nominalDate) {
      issues.push({
        file: "patent.txt",
        line: group.plain.lineNo,
        reason: `unparseable Patent_Expire_Date "${group.plain.expireDateRaw}"`,
        raw: group.plain.raw,
      });
    }
    if (group.ped && !pedDate) {
      issues.push({
        file: "patent.txt",
        line: group.ped.lineNo,
        reason: `unparseable Patent_Expire_Date "${group.ped.expireDateRaw}"`,
        raw: group.ped.raw,
      });
    }

    if (!group.plain) {
      issues.push({
        file: "patent.txt",
        line: anchor.lineNo,
        reason: `patent "${anchor.patentNumberRaw}" has a *PED row with no plain base row; using the *PED date for both nominal and effective expiry`,
        raw: anchor.raw,
      });
    }

    const effective = pedDate ?? nominalDate;
    const nominal = nominalDate ?? pedDate;
    if (!nominal || !effective) {
      issues.push({
        file: "patent.txt",
        line: anchor.lineNo,
        reason: "no usable expiry date found in patent group (both rows unparseable), skipping",
        raw: anchor.raw,
      });
      continue;
    }

    const [base] = anchor.patentNumberRaw.split("*");
    const useCode = anchor.useCodeRaw.trim(); // "" sentinel for "no use code"

    patents.push({
      drugKey: drugKey(anchor.applicationNumber, anchor.productNumber),
      patentNumber: base,
      coversDrugSubstance: parseYFlag(group.plain?.drugSubstanceFlag ?? group.ped?.drugSubstanceFlag ?? ""),
      coversDrugProduct: parseYFlag(group.plain?.drugProductFlag ?? group.ped?.drugProductFlag ?? ""),
      useCode,
      nominalExpiryDate: nominal,
      effectiveExpiryDate: effective,
      expiryAdjustmentDays:
        group.plain && group.ped && nominalDate && pedDate
          ? Math.round((pedDate.getTime() - nominalDate.getTime()) / 86_400_000)
          : null,
      submittedDate: parseObDate(group.plain?.submittedDateRaw ?? group.ped?.submittedDateRaw ?? ""),
    });
  }

  return { patents, rawCount: totalDataLines };
}

function parseExclusivities(
  content: string,
  issues: RowIssue[],
): { exclusivities: ParsedExclusivity[]; rawCount: number } {
  const { rows, totalDataLines } = parseDelimited(content, 5, "exclusivity.txt", issues);
  const exclusivities: ParsedExclusivity[] = [];

  rows.forEach((fields, idx) => {
    const lineNo = idx + 2;
    const raw = fields.join("~");

    if (fields.length !== 5) {
      issues.push({
        file: "exclusivity.txt",
        line: lineNo,
        reason: `expected 5 fields, got ${fields.length}`,
        raw,
      });
      return;
    }

    const [applType, applNo, productNo, code, dateRaw] = fields;

    const applicationType = applType.trim() === "N" ? "NDA" : applType.trim() === "A" ? "ANDA" : null;
    if (!applicationType) {
      issues.push({
        file: "exclusivity.txt",
        line: lineNo,
        reason: `unrecognized Appl_Type "${applType}" (expected N or A)`,
        raw,
      });
      return;
    }

    const applNoTrimmed = applNo.trim();
    const productNoTrimmed = productNo.trim();
    const codeTrimmed = code.trim();
    if (!applNoTrimmed || !productNoTrimmed || !codeTrimmed) {
      issues.push({
        file: "exclusivity.txt",
        line: lineNo,
        reason: "empty Appl_No, Product_No, or Exclusivity_Code",
        raw,
      });
      return;
    }

    const expirationDate = parseObDate(dateRaw);
    if (!expirationDate) {
      issues.push({
        file: "exclusivity.txt",
        line: lineNo,
        reason: `unparseable Exclusivity_Date "${dateRaw}"`,
        raw,
      });
      return;
    }

    exclusivities.push({
      drugKey: drugKey(`${applicationType}${applNoTrimmed}`, productNoTrimmed),
      code: codeTrimmed,
      expirationDate,
    });
  });

  return { exclusivities, rawCount: totalDataLines };
}

export function parseOrangeBookFiles(files: {
  products: string;
  patent: string;
  exclusivity: string;
}): ParseResult {
  const issues: RowIssue[] = [];
  const { products, rawCount: productsRaw } = parseProducts(files.products, issues);
  const { patents, rawCount: patentsRaw } = parsePatents(files.patent, issues);
  const { exclusivities, rawCount: exclusivitiesRaw } = parseExclusivities(files.exclusivity, issues);

  return {
    products,
    patents,
    exclusivities,
    issues,
    rawCounts: { products: productsRaw, patents: patentsRaw, exclusivities: exclusivitiesRaw },
  };
}
