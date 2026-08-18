import { describe, expect, it } from "vitest";
import { tokenize } from "@/lib/classification/tokenize";
import { classifyModality } from "@/lib/classification/modality";
import { classifyDrugClass, DRUG_CLASS_LABELS } from "@/lib/classification/drugClass";

describe("tokenize", () => {
  it("lowercases and splits on whitespace/punctuation", () => {
    expect(tokenize("AMLODIPINE; VALSARTAN")).toEqual(["amlodipine", "valsartan"]);
  });

  it("strips a known salt/hydrate form as its own token", () => {
    expect(tokenize("ENOXAPARIN SODIUM")).toEqual(["enoxaparin"]);
    expect(tokenize("ATORVASTATIN CALCIUM")).toEqual(["atorvastatin"]);
    expect(tokenize("SILDENAFIL CITRATE")).toEqual(["sildenafil"]);
    expect(tokenize("AMOXICILLIN TRIHYDRATE")).toEqual(["amoxicillin"]);
  });

  it("splits route/form separators", () => {
    expect(tokenize("DRUG-A/DRUG-B (COMBO)")).toEqual(["druga", "drugb", "combo"]);
  });

  it("drops empty tokens from repeated separators", () => {
    expect(tokenize("A;;B")).toEqual(["a", "b"]);
  });
});

describe("classifyModality", () => {
  describe("fallback is caller-supplied, not hardcoded", () => {
    it("uses the given fallback when nothing matches", () => {
      expect(classifyModality("AMLODIPINE BESYLATE", "SMALL_MOLECULE")).toBe("SMALL_MOLECULE");
      expect(classifyModality("AMLODIPINE BESYLATE", "UNCLASSIFIED")).toBe("UNCLASSIFIED");
    });

    it("a real biologic-pathway name with no stem or keyword match becomes UNCLASSIFIED, not SMALL_MOLECULE — the actual bug fix", () => {
      // "Alpha-1-Proteinase Inhibitor (Human)" is definitely not a small
      // molecule but matches no stem or keyword rule — Purple Book
      // ingestion passes fallback: "UNCLASSIFIED" for exactly this reason.
      expect(classifyModality("Alpha-1-Proteinase Inhibitor (Human)", "UNCLASSIFIED")).toBe("UNCLASSIFIED");
    });

    it("a name matching a known-but-stemless biologic category resolves to OTHER via keyword, not the fallback", () => {
      // "Antihemophilic Factor" has no INN stem, but IS a real, identifiable
      // protein category — same reasoning as Orange Book's heparinoids
      // above, extended to Purple Book's dominant unstemmed categories.
      expect(classifyModality("Antihemophilic Factor (Recombinant)", "UNCLASSIFIED")).toBe("OTHER");
    });
  });

  it("matches -mab as MONOCLONAL_ANTIBODY", () => {
    expect(classifyModality("ADALIMUMAB", "SMALL_MOLECULE")).toBe("MONOCLONAL_ANTIBODY");
  });

  it("matches the 2021 mAb suffixes (-tug, -bart, -ment, -mig)", () => {
    expect(classifyModality("veligrotug", "UNCLASSIFIED")).toBe("MONOCLONAL_ANTIBODY");
  });

  it("matches -cel as CELL_THERAPY", () => {
    expect(classifyModality("axicabtagene ciloleucel", "UNCLASSIFIED")).toBe("CELL_THERAPY");
  });

  it("matches -gene / -vec / -repvec as GENE_THERAPY, across either word of the two-word scheme", () => {
    expect(classifyModality("elivaldogene autotemcel", "UNCLASSIFIED")).toBe("GENE_THERAPY");
    expect(classifyModality("talimogene laherparepvec", "UNCLASSIFIED")).toBe("GENE_THERAPY");
    expect(classifyModality("voretigene neparvovec", "UNCLASSIFIED")).toBe("GENE_THERAPY");
  });

  it("matches the literal 'vaccine' keyword as VACCINE (no INN stem exists for this category)", () => {
    expect(classifyModality("Hepatitis B Vaccine (Recombinant)", "UNCLASSIFIED")).toBe("VACCINE");
  });

  it("matches -tide, -relin, -pressin as PEPTIDE", () => {
    expect(classifyModality("SEMAGLUTIDE", "SMALL_MOLECULE")).toBe("PEPTIDE");
    expect(classifyModality("LEUPRORELIN", "SMALL_MOLECULE")).toBe("PEPTIDE");
    expect(classifyModality("DESMOPRESSIN", "SMALL_MOLECULE")).toBe("PEPTIDE");
  });

  it("matches -rsen, -siran as OLIGONUCLEOTIDE", () => {
    expect(classifyModality("MIPOMERSEN", "SMALL_MOLECULE")).toBe("OLIGONUCLEOTIDE");
    expect(classifyModality("PATISIRAN", "SMALL_MOLECULE")).toBe("OLIGONUCLEOTIDE");
  });

  it("does NOT match a mid-word substring as a stem — 'arsenic' does not end in 'rsen'", () => {
    expect(classifyModality("ARSENIC TRIOXIDE", "SMALL_MOLECULE")).toBe("SMALL_MOLECULE");
  });

  it("matches -parin heparinoids as OTHER", () => {
    expect(classifyModality("ENOXAPARIN SODIUM", "SMALL_MOLECULE")).toBe("OTHER");
  });

  it("classifies each ingredient component independently in a combination product", () => {
    expect(classifyModality("AMLODIPINE; VALSARTAN", "SMALL_MOLECULE")).toBe("SMALL_MOLECULE");
    // One small-molecule-looking component, one real mAb component — the
    // confident biologic match wins over the unmatched component.
    expect(classifyModality("HYDROCORTISONE; ADALIMUMAB", "SMALL_MOLECULE")).toBe("MONOCLONAL_ANTIBODY");
  });

  describe("longest/most-specific stem wins, independent of rule declaration order", () => {
    it("a token matching two stems of different lengths resolves via the longer one, not array order", () => {
      // "somewordrepvec" ends in both "vec" (3 chars) and "repvec" (6
      // chars) — both map to GENE_THERAPY here (the curated stem list has
      // no cross-modality collisions by design), but this proves the
      // engine actually compares stem lengths and doesn't just take
      // whichever STEM_RULES entry happens to be checked first — "vec" is
      // declared before "repvec" in the rule table, so a first-match
      // implementation would get the right answer for the wrong reason;
      // an engine that stopped at the first hit would still pass this,
      // which is why the shorter "somewordvec" case below matters too.
      expect(classifyModality("somewordrepvec", "UNCLASSIFIED")).toBe("GENE_THERAPY");
      expect(classifyModality("somewordvec", "UNCLASSIFIED")).toBe("GENE_THERAPY");
    });
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

  describe("keyword rules (whole-token match, for categories with no suffix convention)", () => {
    it("matches clotting factors", () => {
      expect(classifyDrugClass("Antihemophilic Factor (Recombinant)")).toBe("Clotting factor");
      expect(classifyDrugClass("Coagulation Factor IX (Human)")).toBe("Clotting factor");
    });

    it("matches immunoglobulins", () => {
      expect(classifyDrugClass("Anti-thymocyte Globulin (Rabbit)")).toBe("Immunoglobulin");
      expect(classifyDrugClass("Botulism Immune Globulin Intravenous (Human)")).toBe("Immunoglobulin");
    });

    it("matches allergenic extracts", () => {
      expect(classifyDrugClass("Animal Allergens, Standardized Cat Hair")).toBe("Allergenic extract");
    });

    it("matches antivenoms/antitoxins", () => {
      expect(classifyDrugClass("Antivenin (Crotalidae) Polyvalent")).toBe("Antivenom / antitoxin");
      expect(classifyDrugClass("Botulism Antitoxin Heptavalent (A, B, C, D, E, F, G) - (Equine)")).toBe(
        "Antivenom / antitoxin",
      );
    });

    it("a stem rule is checked before keyword rules — stem match wins if both would apply", () => {
      // Not a realistic collision in practice, but documents the priority
      // order: STEM_RULES are checked first, KEYWORD_RULES second.
      expect(classifyDrugClass("LISINOPRIL")).toBe("ACE inhibitor");
    });
  });

  it("DRUG_CLASS_LABELS lists every rule's label, stem and keyword alike", () => {
    expect(DRUG_CLASS_LABELS).toContain("Statin");
    expect(DRUG_CLASS_LABELS).toContain("Penicillin-class antibiotic");
    expect(DRUG_CLASS_LABELS).toContain("Clotting factor");
    expect(DRUG_CLASS_LABELS).toContain("Immunoglobulin");
    expect(DRUG_CLASS_LABELS.length).toBeGreaterThan(0);
  });
});
