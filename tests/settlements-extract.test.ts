import { describe, expect, it } from "vitest";
import { extractSettlementsFromFiling } from "@/lib/ingestion/settlements/extract";

// Fixture text mirrors the real shape confirmed live against Bausch
// Health's actual 10-Q/A (see scripts/poc-edgar-settlement.ts) — a
// SETTLED dispute (Actavis) and a STILL-ONGOING one (Sandoz) under the
// exact same "<Drug> Patent Litigation (<Party>) - ..." heading template
// in the same filing. Distinguishing the two is the whole point of
// extract.ts: a heading match alone is not evidence of a settlement.
const REAL_SHAPE_FILING_TEXT = `
Xifaxan ® 550mg Patent Litigation (Actavis) - On March 23, 2016, the Company initiated litigation against
Actavis Laboratories FL, Inc. ("Actavis"), which alleged infringement by Actavis of one or more claims of
each of the Xifaxan ® patents. On September 12, 2018, we announced that we had reached an agreement with
Actavis that resolved the existing litigation and eliminated the pending challenges to our intellectual
property protecting Xifaxan ® (rifaximin) 550 mg tablets. As part of the agreement, the parties agreed to
dismiss all litigation related to Xifaxan ® (rifaximin), Actavis acknowledged the validity of the licensed
patents for Xifaxan ® (rifaximin) 550 mg tablets and all intellectual property protecting Xifaxan ® (rifaximin)
550 mg tablets will remain intact and enforceable until expiry in 2029. The agreement also grants Actavis a
non-exclusive license to the intellectual property relating to Xifaxan ® (rifaximin) 550 mg tablets in the
United States beginning January 1, 2028 (or earlier under certain circumstances). The Company will not make
any financial payments or other transfers of value as part of the agreement.
Xifaxan ® 550mg Patent Litigation (Sandoz) - In October 2019, the Company announced that it and its licensor,
Alfasigma, had commenced litigation against Sandoz Inc. ("Sandoz"), a Novartis division, alleging patent
infringement of 14 patents by Sandoz's filing of its ANDA for Xifaxan ® (rifaximin) 550 mg tablets. The
litigation remains ongoing.
`;

describe("extractSettlementsFromFiling", () => {
  it("REGRESSION: extracts the real Xifaxan/Actavis settlement with the correct licensed-entry date", () => {
    const results = extractSettlementsFromFiling(REAL_SHAPE_FILING_TEXT, "Xifaxan");
    const actavis = results.find((r) => r.counterpartyNameRaw === "Actavis");
    expect(actavis).toBeDefined();
    expect(actavis!.licensedEntryDate).toBe("2028-01-01");
    expect(actavis!.settlementAnnouncedDate).toBe("2018-09-12");
    expect(actavis!.earlierCircumstancesNoted).toBe(true);
    expect(actavis!.confidence).toBe("HIGH");
  });

  it("does NOT extract a still-ongoing dispute under the same heading template", () => {
    const results = extractSettlementsFromFiling(REAL_SHAPE_FILING_TEXT, "Xifaxan");
    expect(results.find((r) => r.counterpartyNameRaw === "Sandoz")).toBeUndefined();
  });

  it("returns exactly one result for a filing with one settled and one ongoing dispute", () => {
    const results = extractSettlementsFromFiling(REAL_SHAPE_FILING_TEXT, "Xifaxan");
    expect(results).toHaveLength(1);
  });

  it("returns an empty array when the drug name never appears", () => {
    expect(extractSettlementsFromFiling("Some unrelated 10-K text about a different product.", "Xifaxan")).toEqual([]);
  });

  it("assigns MEDIUM confidence when settlement language is present but no licensed-entry date can be extracted", () => {
    const text = `Acme ® Patent Litigation (Zeta Labs) - On June 1, 2021, the Company initiated litigation against
    Zeta Labs Inc. ("Zeta Labs"). On July 4, 2022, we announced that we had reached an agreement with Zeta Labs
    that resolved the existing litigation, on terms the Company has not disclosed.`;
    const results = extractSettlementsFromFiling(text, "Acme");
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe("MEDIUM");
    expect(results[0].licensedEntryDate).toBeNull();
    expect(results[0].settlementAnnouncedDate).toBe("2022-07-04");
  });

  it("handles multiple settled counterparties in one filing", () => {
    const text = `Acme ® Patent Litigation (Zeta Labs) - We announced that we had reached an agreement with
    Zeta Labs that resolved the existing litigation, with a license beginning January 1, 2030.
    Acme ® Patent Litigation (Omega Pharma) - We announced that we had reached an agreement with Omega Pharma
    that resolved the existing litigation, with a license beginning March 15, 2031.`;
    const results = extractSettlementsFromFiling(text, "Acme");
    expect(results.map((r) => r.counterpartyNameRaw).sort()).toEqual(["Omega Pharma", "Zeta Labs"]);
    expect(results.find((r) => r.counterpartyNameRaw === "Zeta Labs")?.licensedEntryDate).toBe("2030-01-01");
    expect(results.find((r) => r.counterpartyNameRaw === "Omega Pharma")?.licensedEntryDate).toBe("2031-03-15");
  });
});
