// Shape of one skipped/malformed row, kept for logging — never thrown.
export interface RowIssue {
  file: "products.txt" | "patent.txt" | "exclusivity.txt";
  line: number;
  reason: string;
  raw: string;
}

export interface ParsedProduct {
  brandName: string;
  genericName: string;
  companyName: string;
  applicationType: "NDA" | "ANDA";
  applicationNumber: string;
  productNumber: string;
  dosageForm: string;
  route: string;
  strength: string;
  approvalDate: Date | null;
  drugKey: string; // applicationNumber + "::" + productNumber
}

export interface ParsedPatent {
  drugKey: string;
  patentNumber: string;
  coversDrugSubstance: boolean;
  coversDrugProduct: boolean;
  useCode: string; // "" sentinel for "no use code" — see schema.prisma comment on Patent.useCode
  nominalExpiryDate: Date;
  effectiveExpiryDate: Date;
  expiryAdjustmentDays: number | null;
  submittedDate: Date | null;
}

export interface ParsedExclusivity {
  drugKey: string;
  code: string;
  expirationDate: Date;
}

export interface ParseResult {
  products: ParsedProduct[];
  patents: ParsedPatent[];
  exclusivities: ParsedExclusivity[];
  issues: RowIssue[];
  rawCounts: { products: number; patents: number; exclusivities: number };
}

export interface LoadCounts {
  drugsUpserted: number;
  patentsUpserted: number;
  exclusivitiesUpserted: number;
  drugsSkipped: number;
  patentsSkipped: number;
  exclusivitiesSkipped: number;
}
