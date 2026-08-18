// Shape of one skipped/malformed row, kept for logging — never thrown.
// Mirrors orangeBook/types.ts's RowIssue exactly, with Purple Book's two
// source files instead of Orange Book's three.
export interface RowIssue {
  file: "products.csv" | "patent-list.html";
  line: number; // 1-indexed data row number, or -1 when not line-addressable (e.g. patent-list.html rows)
  reason: string;
  raw: string;
}

export type LicenseType = "STANDARD" | "BIOSIMILAR" | "INTERCHANGEABLE";
export type BiologicCenter = "CDER" | "CBER";

export interface ParsedBiologicProduct {
  blaProductKey: string; // blaNumber + "::" + productNumber — the BiologicProduct natural key
  blaNumber: string;
  productNumber: string;
  companyName: string;
  proprietaryName: string;
  properName: string;
  licenseType: LicenseType;
  center: BiologicCenter;
  dosageForm: string;
  route: string;
  strength: string;
  marketingStatus: string | null;
  approvalDate: Date | null;
  // Kept as raw source names, not yet resolved to a BiologicProduct id —
  // resolution happens in a second pass in load.ts, once every product in
  // this ingestion run has been upserted and can be matched against.
  referenceProductProprietaryNameRaw: string | null;
  referenceProductProperNameRaw: string | null;
}

// One row per BPCIA exclusivity mechanism found for a product — a single
// CSV row can produce zero, one, two, or three of these (reference-product,
// first-interchangeable, orphan), unlike Orange Book where each
// exclusivity.txt row is already exactly one exclusivity.
export interface ParsedBiologicExclusivity {
  blaProductKey: string;
  code: "BPCIA_REF_PRODUCT" | "BPCIA_FIRST_INTERCHANGEABLE" | "ORPHAN";
  expirationDate: Date;
}

// From the separate, much sparser patent-list page — see
// purpleBook/parsePatentList.ts for why this has no filing date or use
// code. Matched back to a BiologicProduct by BLA number only (the patent
// list has no product-number grain — a patent applies to the whole
// reference product, not one specific strength/presentation), so this maps
// to every BiologicProduct row sharing that BLA number in load.ts.
export interface ParsedBiologicPatent {
  blaNumber: string;
  patentNumber: string;
  sourceExpirationDate: Date;
}

export interface ParseResult {
  products: ParsedBiologicProduct[];
  exclusivities: ParsedBiologicExclusivity[];
  patents: ParsedBiologicPatent[];
  issues: RowIssue[];
  rawCounts: { products: number; patents: number };
}
