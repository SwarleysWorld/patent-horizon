import { describe, expect, it } from "vitest";
import { parseProductsCsv } from "@/lib/ingestion/purpleBook/parseProducts";

const HEADER =
  "N/R/U,Applicant,BLA Number,Proprietary Name,Proper Name,License Type,Strength,Dosage Form,Route of Administration,Product Presentation,Marketing Status,Licensure,Approval Date,Inter. Approval Date,Ref. Product Proper Name,Ref. Product Proprietary Name,Supplement Number,Submission Type,Inter. Supplement Number,License Number,Product Number,Center,Date of First Licensure,Exclusivity Expiration Date,First Interchangeable Exclusivity Exp. Date,Ref. Product Exclusivity Exp. Date,Orphan Exclusivity Exp. Date,Patent List Provided";

// Builds a minimal file with the real two-section layout: a change-log
// section (header + a few rows, using the long-month-name date format seen
// in that section for real) then a SECOND copy of the header followed by
// the full-snapshot rows (using the short day-Mon-2digitYear format seen
// in that section for real) — parseProductsCsv should only read the rows
// after the LAST header.
function buildCsv(snapshotRows: string[]): string {
  const changeLogRow =
    'U,Some Applicant,999999,"Some Product",some ingredient,351(a),10MG,Tablet,Oral,Vial,Rx,Licensed,"July 23, 1986",, ,,0,Original,,0001,001,CDER,,,,,,';
  return [HEADER, changeLogRow, HEADER, ...snapshotRows].join("\n");
}

function row(overrides: Partial<Record<string, string>> = {}): string {
  const defaults: Record<string, string> = {
    "N/R/U": "",
    Applicant: "Acme Biologics Inc.",
    "BLA Number": "123456",
    "Proprietary Name": "Testazumab",
    "Proper Name": "testazumab",
    "License Type": "351(a)",
    Strength: "100MG",
    "Dosage Form": "Injection",
    "Route of Administration": "Intravenous",
    "Product Presentation": "Single-Dose Vial",
    "Marketing Status": "Rx",
    Licensure: "Licensed",
    "Approval Date": "15-Jan-74",
    "Inter. Approval Date": "",
    "Ref. Product Proper Name": "N/A",
    "Ref. Product Proprietary Name": "N/A",
    "Supplement Number": "0",
    "Submission Type": "Original",
    "Inter. Supplement Number": "",
    "License Number": "1234",
    "Product Number": "001",
    Center: "CDER",
    "Date of First Licensure": "",
    "Exclusivity Expiration Date": "",
    "First Interchangeable Exclusivity Exp. Date": "",
    "Ref. Product Exclusivity Exp. Date": "",
    "Orphan Exclusivity Exp. Date": "",
    "Patent List Provided": "",
  };
  const merged = { ...defaults, ...overrides };
  const fields = HEADER.split(",").map((col) => {
    const v = merged[col] ?? "";
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  });
  return fields.join(",");
}

describe("parseProductsCsv", () => {
  it("only parses the full-snapshot section (after the LAST header row), not the change-log section", () => {
    const csv = buildCsv([row({ "BLA Number": "555555", "Proprietary Name": "SnapshotOnly" })]);
    const { products } = parseProductsCsv(csv);
    expect(products).toHaveLength(1);
    expect(products[0].proprietaryName).toBe("SnapshotOnly");
    expect(products.some((p) => p.proprietaryName === "Some Product")).toBe(false);
  });

  describe("date parsing — the two real formats, plus the real 2-digit-year regression", () => {
    it("parses the short day-Mon-2digitYear format used in the snapshot section", () => {
      const csv = buildCsv([row({ "Approval Date": "15-Jan-74" })]);
      const { products } = parseProductsCsv(csv);
      expect(products[0].approvalDate?.toISOString().slice(0, 10)).toBe("1974-01-15");
    });

    it("REGRESSION: a 2-digit year of 31 must resolve to 2031, not 1931 (real Keytruda exclusivity date, caught via live verification)", () => {
      const csv = buildCsv([row({ "Ref. Product Exclusivity Exp. Date": "25-Jan-31" })]);
      const { exclusivities } = parseProductsCsv(csv);
      const refProductExcl = exclusivities.find((e) => e.code === "BPCIA_REF_PRODUCT");
      expect(refProductExcl?.expirationDate.toISOString().slice(0, 10)).toBe("2031-01-25");
    });

    it("resolves 2-digit years across the real observed range correctly (00-32 -> 20XX, 64-99 -> 19XX)", () => {
      const cases: [string, string][] = [
        ["1-Jan-00", "2000-01-01"],
        ["1-Jan-26", "2026-01-01"],
        ["1-Jan-32", "2032-01-01"],
        ["1-Jan-64", "1964-01-01"],
        ["1-Jan-99", "1999-01-01"],
      ];
      for (const [raw, expected] of cases) {
        const csv = buildCsv([row({ "Approval Date": raw })]);
        const { products } = parseProductsCsv(csv);
        expect(products[0].approvalDate?.toISOString().slice(0, 10), `for raw "${raw}"`).toBe(expected);
      }
    });

    it("also parses the long-month-name format, for robustness even though the snapshot section doesn't use it", () => {
      const csv = buildCsv([row({ "Approval Date": "July 23, 1986" })]);
      const { products } = parseProductsCsv(csv);
      expect(products[0].approvalDate?.toISOString().slice(0, 10)).toBe("1986-07-23");
    });

    it('treats "Date TBD" as a real, expected sentinel — no exclusivity created, no issue logged', () => {
      const csv = buildCsv([row({ "First Interchangeable Exclusivity Exp. Date": "Date TBD" })]);
      const { exclusivities, issues } = parseProductsCsv(csv);
      expect(exclusivities.some((e) => e.code === "BPCIA_FIRST_INTERCHANGEABLE")).toBe(false);
      expect(issues).toHaveLength(0);
    });

    it("logs an issue for a genuinely unparseable date (not blank, not Date TBD)", () => {
      const csv = buildCsv([row({ "Orphan Exclusivity Exp. Date": "not-a-real-date" })]);
      const { issues } = parseProductsCsv(csv);
      expect(issues.some((i) => i.reason.includes("Orphan"))).toBe(true);
    });
  });

  describe("reference product name sentinel", () => {
    it('treats "N/A" as no reference product (not a literal name)', () => {
      const csv = buildCsv([row({ "Ref. Product Proprietary Name": "N/A", "Ref. Product Proper Name": "N/A" })]);
      const { products } = parseProductsCsv(csv);
      expect(products[0].referenceProductProprietaryNameRaw).toBeNull();
      expect(products[0].referenceProductProperNameRaw).toBeNull();
    });

    it("keeps a real reference product name", () => {
      const csv = buildCsv([row({ "Ref. Product Proprietary Name": "Humira", "Ref. Product Proper Name": "adalimumab" })]);
      const { products } = parseProductsCsv(csv);
      expect(products[0].referenceProductProprietaryNameRaw).toBe("Humira");
      expect(products[0].referenceProductProperNameRaw).toBe("adalimumab");
    });
  });

  it("handles a quoted field containing an embedded comma (real RFC4180 CSV, not Orange Book's simple delimited format)", () => {
    const csv = buildCsv([row({ "Proprietary Name": "Recombivax, Recombivax Hb" })]);
    const { products } = parseProductsCsv(csv);
    expect(products[0].proprietaryName).toBe("Recombivax, Recombivax Hb");
  });

  describe("malformed/incomplete rows never crash the pipeline", () => {
    it("skips a row with an empty required field and logs why", () => {
      const csv = buildCsv([row({ "Proprietary Name": "" })]);
      const { products, issues } = parseProductsCsv(csv);
      expect(products).toHaveLength(0);
      expect(issues[0].reason).toContain("empty");
    });

    it("skips a row with an unrecognized License Type", () => {
      const csv = buildCsv([row({ "License Type": "351(z) Nonsense" })]);
      const { products, issues } = parseProductsCsv(csv);
      expect(products).toHaveLength(0);
      expect(issues[0].reason).toContain("License Type");
    });

    it("skips a row with an unrecognized Center", () => {
      const csv = buildCsv([row({ Center: "CFSAN" })]);
      const { products, issues } = parseProductsCsv(csv);
      expect(products).toHaveLength(0);
      expect(issues[0].reason).toContain("Center");
    });
  });

  it("parses all three BPCIA exclusivity types from a single row", () => {
    const csv = buildCsv([
      row({
        "Ref. Product Exclusivity Exp. Date": "1-Jan-30",
        "First Interchangeable Exclusivity Exp. Date": "1-Jan-25",
        "Orphan Exclusivity Exp. Date": "1-Jan-28",
      }),
    ]);
    const { exclusivities } = parseProductsCsv(csv);
    expect(exclusivities.map((e) => e.code).sort()).toEqual(
      ["BPCIA_FIRST_INTERCHANGEABLE", "BPCIA_REF_PRODUCT", "ORPHAN"].sort(),
    );
  });

  it("does not read the legacy 'Exclusivity Expiration Date' column (vestigial, 0-filled in real data)", () => {
    const csv = buildCsv([row({ "Exclusivity Expiration Date": "1-Jan-30" })]);
    const { exclusivities } = parseProductsCsv(csv);
    expect(exclusivities).toHaveLength(0);
  });

  it("maps license type strings to the internal enum correctly", () => {
    const csv = buildCsv([
      row({ "BLA Number": "1", "License Type": "351(a)" }),
      row({ "BLA Number": "2", "License Type": "351(k) Biosimilar" }),
      row({ "BLA Number": "3", "License Type": "351(k) Interchangeable" }),
    ]);
    const { products } = parseProductsCsv(csv);
    expect(products.map((p) => p.licenseType)).toEqual(["STANDARD", "BIOSIMILAR", "INTERCHANGEABLE"]);
  });
});
