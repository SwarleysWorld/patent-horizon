import { describe, expect, it } from "vitest";
import { rowToChallenge, COLUMN_KEYS, type ColumnKey } from "@/lib/ingestion/paragraphIV/parsePdf";
import type { RowIssue } from "@/lib/ingestion/paragraphIV/types";

// Row fixtures below mirror real rows confirmed directly against a live
// download of FDA's Paragraph IV Patent Certifications List PDF — see
// README "Data ingestion: Paragraph IV Certifications" for the research.

function row(overrides: Partial<Record<ColumnKey, string>> = {}): Record<ColumnKey, string> {
  const defaults: Record<ColumnKey, string> = Object.fromEntries(COLUMN_KEYS.map((k) => [k, ""])) as Record<
    ColumnKey,
    string
  >;
  return { ...defaults, ...overrides };
}

function parse(cols: Record<ColumnKey, string>) {
  const issues: RowIssue[] = [];
  const challenge = rowToChallenge(cols, 1, issues);
  return { challenge, issues };
}

describe("rowToChallenge", () => {
  it("parses a normal single-value row (Ziagen)", () => {
    const { challenge, issues } = parse(
      row({
        activeIngredient: "Abacavir Sulfate",
        dosageForm: "Tablets",
        strength: "300 mg",
        rldNda: "Ziagen\n20977",
        dateOfSubmission: "1/28/2009",
        numberOfAndas: "1",
        status180Day: "Eligible",
        posting180Day: "2/11/2020",
        firstApplicantApproval: "6/18/2012",
        firstCommercialMarketing: "6/19/2012",
        expirationLastQualifyingPatent: "5/14/2018",
      }),
    );
    expect(issues).toHaveLength(0);
    expect(challenge).toMatchObject({
      rldName: "Ziagen",
      rldNdaNumber: "NDA020977",
      submissionDateType: "EXACT_DATE",
      currentStatus: "ELIGIBLE",
      dateOfFirstCommercialMarketing: new Date("2012-06-19T00:00:00.000Z"),
    });
    expect(challenge!.decisionHistory).toEqual([{ status: "ELIGIBLE", postingDate: "2020-02-11", rawStatusText: "Eligible" }]);
  });

  describe("Date of Submission edge cases", () => {
    it("recognizes Pre-MMA as a distinct state, not a parse failure", () => {
      const { challenge, issues } = parse(
        row({ activeIngredient: "Famotidine", dosageForm: "Tablets", rldNda: "Pepcid\n19462", dateOfSubmission: "Pre-MMA" }),
      );
      expect(issues).toHaveLength(0);
      expect(challenge).toMatchObject({ submissionDateType: "PRE_MMA", submissionDate: null });
    });

    it("recognizes 'PIV received prior to <date>' as a distinct state with a real upper-bound date", () => {
      const { challenge, issues } = parse(
        row({
          activeIngredient: "Clarithromycin",
          dosageForm: "Extended-release Tablets",
          rldNda: "Biaxin XL\n50775",
          dateOfSubmission: "PIV received\nprior to\n2/5/2009",
        }),
      );
      expect(issues).toHaveLength(0);
      expect(challenge).toMatchObject({ submissionDateType: "RECEIVED_PRIOR_TO", submissionDate: new Date("2009-02-05T00:00:00.000Z") });
    });

    it("blank trailing columns are 'not applicable', not logged, when submission is Pre-MMA", () => {
      const { challenge, issues } = parse(
        row({ activeIngredient: "Famotidine", dosageForm: "Injection", rldNda: "Pepcid\n19462", dateOfSubmission: "Pre-MMA" }),
      );
      expect(issues).toHaveLength(0);
      expect(challenge).toMatchObject({ currentStatus: null, decisionHistory: [] });
    });

    it("logs an issue for a genuinely unrecognized Date of Submission value", () => {
      const { issues } = parse(row({ activeIngredient: "X", dosageForm: "Tablets", rldNda: "Y\n12345", dateOfSubmission: "garbled" }));
      expect(issues.some((i) => i.reason.includes("unrecognized Date of Submission"))).toBe(true);
    });
  });

  describe("RLD/NDA cell", () => {
    it("splits a name that wraps across multiple lines from the trailing number", () => {
      const { challenge } = parse(
        row({ activeIngredient: "X", dosageForm: "Tablets", rldNda: "Excedrin\n(migraine)\n20802", dateOfSubmission: "1/1/2010" }),
      );
      expect(challenge).toMatchObject({ rldName: "Excedrin (migraine)", rldNdaNumber: "NDA020802" });
    });

    it("strips a literal 'NDA' prefix on the number line", () => {
      const { challenge } = parse(row({ activeIngredient: "X", dosageForm: "Tablets", rldNda: "Bijuva\nNDA 210132", dateOfSubmission: "1/1/2020" }));
      expect(challenge!.rldNdaNumber).toBe("NDA210132");
    });

    it("logs 'no RLD/NDA number' rather than guessing when the cell has no number at all — confirmed real, ~5% of rows", () => {
      const { challenge, issues } = parse(row({ activeIngredient: "Famotidine", dosageForm: "Tablets", rldNda: "Pepcid AC", dateOfSubmission: "Pre-MMA" }));
      expect(challenge!.rldNdaNumber).toBeNull();
      expect(issues.some((i) => i.reason === "no RLD/NDA number in source data")).toBe(true);
    });

    it("logs (not guesses) a malformed too-long number rather than silently truncating or padding it", () => {
      const { challenge, issues } = parse(row({ activeIngredient: "Safinamide", dosageForm: "Tablets", rldNda: "Xadago\n2071454", dateOfSubmission: "1/1/2020" }));
      expect(challenge!.rldNdaNumber).toBeNull();
      expect(challenge!.rldNdaNumberRaw).toBe("2071454");
      expect(issues.some((i) => i.reason.includes("did not normalize cleanly"))).toBe(true);
    });
  });

  describe("180-Day Status / Posting Date", () => {
    it("stacks multiple statuses most-recent-first when the source lists more than one", () => {
      const { challenge, issues } = parse(
        row({
          activeIngredient: "X",
          dosageForm: "Injection",
          rldNda: "Y\n12345",
          dateOfSubmission: "1/1/2010",
          status180Day: "Extinguished\nEligible",
          posting180Day: "1/12/2021\n2/11/2020",
        }),
      );
      expect(issues).toHaveLength(0);
      expect(challenge!.decisionHistory).toEqual([
        { status: "EXTINGUISHED", postingDate: "2021-01-12", rawStatusText: "Extinguished" },
        { status: "ELIGIBLE", postingDate: "2020-02-11", rawStatusText: "Eligible" },
      ]);
      expect(challenge!.currentStatus).toBe("EXTINGUISHED");
    });

    it("pairs a status with no posting date at all without treating it as an error — confirmed real, 5 rows", () => {
      const { challenge, issues } = parse(
        row({
          activeIngredient: "X",
          dosageForm: "Tablets",
          rldNda: "Y\n12345",
          dateOfSubmission: "1/1/2010",
          status180Day: "Extinguished",
          posting180Day: "",
        }),
      );
      expect(issues).toHaveLength(0);
      expect(challenge!.decisionHistory).toEqual([{ status: "EXTINGUISHED", postingDate: null, rawStatusText: "Extinguished" }]);
    });

    it("coalesces a per-strength-qualified status wrapped across two lines into one entry — confirmed real, Vasostrict", () => {
      const { challenge, issues } = parse(
        row({
          activeIngredient: "Vasopressin",
          dosageForm: "Injection",
          rldNda: "Vasostrict\n204485",
          dateOfSubmission: "2/28/2022",
          status180Day: "40 u/100 mL -\nExtinguished",
          posting180Day: "8/18/2025",
        }),
      );
      expect(issues).toHaveLength(0);
      expect(challenge!.decisionHistory).toEqual([
        { status: "EXTINGUISHED", postingDate: "2025-08-18", rawStatusText: "40 u/100 mL - Extinguished" },
      ]);
    });

    it("logs an issue when a status/date pairing can't be resolved cleanly (genuine source corruption, e.g. a malformed date)", () => {
      const { issues } = parse(
        row({
          activeIngredient: "X",
          dosageForm: "Tablets",
          rldNda: "Y\n12345",
          dateOfSubmission: "1/1/2010",
          status180Day: "Extinguished",
          posting180Day: "87/2023",
        }),
      );
      expect(issues.some((i) => i.reason.includes("did not map cleanly"))).toBe(true);
    });
  });

  describe("multi-value marketing/expiration date cells", () => {
    it("flags (does not guess) a cell with more than one date token", () => {
      const { challenge, issues } = parse(
        row({
          activeIngredient: "Bupropion Hydrochloride",
          dosageForm: "Extended-release Tablets",
          rldNda: "Wellbutrin XL\n21515",
          dateOfSubmission: "9/21/2004",
          firstCommercialMarketing: "5/30/2008 -\n150 mg\n12/4/2006 -\n300 mg",
        }),
      );
      expect(challenge!.dateOfFirstCommercialMarketing).toBeNull();
      expect(challenge!.rawNotes).toContain("firstCommercialMarketing raw");
      expect(issues.some((i) => i.reason.includes("multiple values that could not be unambiguously split"))).toBe(true);
    });

    it("parses a single unambiguous date normally", () => {
      const { challenge, issues } = parse(
        row({ activeIngredient: "X", dosageForm: "Tablets", rldNda: "Y\n12345", dateOfSubmission: "1/1/2010", firstCommercialMarketing: "6/19/2012" }),
      );
      expect(issues).toHaveLength(0);
      expect(challenge!.dateOfFirstCommercialMarketing).toEqual(new Date("2012-06-19T00:00:00.000Z"));
    });
  });

  it("returns null and logs an issue for a row missing required fields, rather than crashing", () => {
    const { challenge, issues } = parse(row({ activeIngredient: "", dosageForm: "" }));
    expect(challenge).toBeNull();
    expect(issues.some((i) => i.reason.includes("missing active ingredient"))).toBe(true);
  });
});
