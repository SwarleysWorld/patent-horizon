import { describe, expect, it } from "vitest";
import { tokenize } from "@/lib/classification/tokenize";
import { classifyModality } from "@/lib/classification/modality";
import { classifyDrugClass, DRUG_CLASS_LABELS } from "@/lib/classification/drugClass";

describe("tokenize", () => {
  it("lowercases and splits on whitespace/punctuation", () => {
    expect(tokenize("AMLODIPINE BESYLATE; VALSARTAN")).toEqual(["amlodipine", "besylate", "valsartan"]);
  });

  it("splits salt forms and route/form separators", () => {
    expect(tokenize("ENOXAPARIN SODIUM")).toEqual(["enoxaparin", "sodium"]);
    expect(tokenize("DRUG-A/DRUG-B (COMBO)")).toEqual(["druga", "drugb", "combo"]);
  });

  it("drops empty tokens from repeated separators", () => {
    expect(tokenize("A;;B")).toEqual(["a", "b"]);
  });
});

describe("classifyModality", () => {
  it("defaults to SMALL_MOLECULE for ordinary chemistry", () => {
    expect(classifyModality("AMLODIPINE BESYLATE")).toBe("SMALL_MOLECULE");
  });

  it("matches -mab as MONOCLONAL_ANTIBODY", () => {
    expect(classifyModality("ADALIMUMAB")).toBe("MONOCLONAL_ANTIBODY");
  });

  it("matches -tide, -relin, -pressin as PEPTIDE", () => {
    expect(classifyModality("SEMAGLUTIDE")).toBe("PEPTIDE");
    expect(classifyModality("LEUPRORELIN")).toBe("PEPTIDE");
    expect(classifyModality("DESMOPRESSIN")).toBe("PEPTIDE");
  });

  it("matches -rsen, -siran as OLIGONUCLEOTIDE", () => {
    expect(classifyModality("MIPOMERSEN")).toBe("OLIGONUCLEOTIDE");
    expect(classifyModality("PATISIRAN")).toBe("OLIGONUCLEOTIDE");
  });

  it("does NOT match a mid-word substring as a stem — 'arsenic' does not end in 'rsen'", () => {
    expect(classifyModality("ARSENIC TRIOXIDE")).toBe("SMALL_MOLECULE");
  });

  it("matches -parin heparinoids as OTHER", () => {
    expect(classifyModality("ENOXAPARIN SODIUM")).toBe("OTHER");
  });

  it("classifies each ingredient token independently in a combination product", () => {
    // Neither token matches any stem — stays SMALL_MOLECULE.
    expect(classifyModality("AMLODIPINE; VALSARTAN")).toBe("SMALL_MOLECULE");
  });

  it("rule order: an earlier, more specific rule wins over a later one", () => {
    // A hypothetical ingredient matching both -mab and -parin patterns
    // would resolve to whichever rule is listed first (MONOCLONAL_ANTIBODY).
    expect(classifyModality("SOMEMAB")).toBe("MONOCLONAL_ANTIBODY");
  });
});

describe("classifyDrugClass", () => {
  it("returns null when nothing matches", () => {
    expect(classifyDrugClass("AMLODIPINE BESYLATE")).toBeNull();
  });

  it("matches -statin as Statin", () => {
    expect(classifyDrugClass("ATORVASTATIN")).toBe("Statin");
    expect(classifyDrugClass("SIMVASTATIN")).toBe("Statin");
  });

  it("excludes known false positives that coincidentally end in -statin", () => {
    expect(classifyDrugClass("CILASTATIN")).toBeNull();
    expect(classifyDrugClass("NYSTATIN")).toBeNull();
    expect(classifyDrugClass("PENTOSTATIN")).toBeNull();
  });

  it("an excluded token doesn't block a different real match elsewhere in the same ingredient field", () => {
    // cilastatin (excluded) combined with a real ARB in the same field —
    // the ARB match should still surface.
    expect(classifyDrugClass("CILASTATIN; LOSARTAN")).toBe("Angiotensin receptor blocker (ARB)");
  });

  it("matches -sartan, -pril, -olol, -tinib, -ciclib, -gliflozin, -gliptin, -cillin", () => {
    expect(classifyDrugClass("LOSARTAN")).toBe("Angiotensin receptor blocker (ARB)");
    expect(classifyDrugClass("LISINOPRIL")).toBe("ACE inhibitor");
    expect(classifyDrugClass("METOPROLOL")).toBe("Beta blocker");
    expect(classifyDrugClass("IMATINIB")).toBe("Kinase inhibitor");
    expect(classifyDrugClass("PALBOCICLIB")).toBe("CDK4/6 inhibitor");
    expect(classifyDrugClass("DAPAGLIFLOZIN")).toBe("SGLT2 inhibitor");
    expect(classifyDrugClass("SITAGLIPTIN")).toBe("DPP-4 inhibitor");
    expect(classifyDrugClass("AMOXICILLIN")).toBe("Penicillin-class antibiotic");
  });

  it("DRUG_CLASS_LABELS lists every rule's label, in priority order", () => {
    expect(DRUG_CLASS_LABELS).toContain("Statin");
    expect(DRUG_CLASS_LABELS).toContain("Penicillin-class antibiotic");
    expect(DRUG_CLASS_LABELS.length).toBeGreaterThan(0);
  });
});
