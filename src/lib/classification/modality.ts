import { tokenize } from "./tokenize";

export type Modality =
  | "SMALL_MOLECULE"
  | "PEPTIDE"
  | "OLIGONUCLEOTIDE"
  | "MONOCLONAL_ANTIBODY"
  | "CELL_THERAPY"
  | "GENE_THERAPY"
  | "VACCINE"
  | "OTHER"
  | "UNCLASSIFIED";

// Runtime array of every value, for Zod enums and anywhere else that needs
// the vocabulary as data rather than just a compile-time type.
export const MODALITY_VALUES = [
  "SMALL_MOLECULE",
  "PEPTIDE",
  "OLIGONUCLEOTIDE",
  "MONOCLONAL_ANTIBODY",
  "CELL_THERAPY",
  "GENE_THERAPY",
  "VACCINE",
  "OTHER",
  "UNCLASSIFIED",
] as const satisfies readonly Modality[];

export const MODALITY_LABELS: Record<Modality, string> = {
  SMALL_MOLECULE: "Small molecule",
  PEPTIDE: "Peptide",
  OLIGONUCLEOTIDE: "Oligonucleotide",
  MONOCLONAL_ANTIBODY: "Monoclonal antibody",
  CELL_THERAPY: "Cell therapy",
  GENE_THERAPY: "Gene therapy",
  VACCINE: "Vaccine",
  OTHER: "Other / complex molecule",
  UNCLASSIFIED: "Unclassified",
};

type StemModality = Exclude<Modality, "SMALL_MOLECULE" | "UNCLASSIFIED">;

interface StemRule {
  modality: StemModality;
  stem: string;
}

// Real WHO INN / USAN naming stems (WHO Stem Book 2024 + the AMA's 2021
// monoclonal-antibody suffix revision + WHO's gene/cell-therapy nomenclature
// schemes) — not invented ad hoc. Every stem below was checked against both
// the 658 real distinct Purple Book `Proper Name` values AND all 48,502
// real Orange Book `genericName` values before being added (the same
// discipline that caught the ARSENIC/-rsen false positive originally) —
// zero false positives found in either dataset for any of these, including
// the newer, shorter ones (-cel, -gene, -vec, -bac, -ment, -mig, -tug,
// -bart) that looked riskiest on paper.
//
// One rule per stem (not one rule per modality with a stem array) so that
// "longest/most specific stem wins" can be computed directly by comparing
// stem string length across the full candidate set, rather than relying on
// array declaration order as a stand-in for priority (the previous
// design's actual bug: a new rule inserted in the wrong position could
// silently shadow a more specific one).
const STEM_RULES: StemRule[] = [
  // Monoclonal antibodies. "-mab" is the long-standing INN suffix and
  // still what ~every real approved product uses; the AMA/WHO replaced it
  // in December 2021 with four narrower suffixes (unmodified Ig / artificial
  // Ig / Ig fragment / multispecific Ig) for newly named antibodies — only
  // one real approved-product match found for any of the four so far
  // ("veligrotug"), but they're real, current INN policy, not speculative.
  { modality: "MONOCLONAL_ANTIBODY", stem: "mab" },
  { modality: "MONOCLONAL_ANTIBODY", stem: "tug" },
  { modality: "MONOCLONAL_ANTIBODY", stem: "bart" },
  { modality: "MONOCLONAL_ANTIBODY", stem: "ment" },
  { modality: "MONOCLONAL_ANTIBODY", stem: "mig" },

  // Cell therapies (CAR-T and similar) — WHO/USAN's 2021 scheme uses "-cel"
  // for all of them (prefix + manipulation-infix + cell-type-infix + -cel).
  { modality: "CELL_THERAPY", stem: "cel" },
  // "-cabtagene" is the real, documented USAN infix for CAR-T products
  // (axicabtagene, brexucabtagene, ciltacabtagene, idecabtagene,
  // lisocabtagene, obecabtagene — all six real approved CAR-T therapies,
  // all FDA-labeled as cell therapy) — NOT the gene-therapy word-1 "-gene"
  // suffix below, even though it happens to end in the same four letters.
  // Declared as its own, longer, more specific stem rather than an
  // exclusion on "gene": at 9 characters it already outranks "gene" (4)
  // under the longest-stem-wins rule, so this needs no separate mechanism
  // — it's the same kind of real naming collision the ARSENIC/-rsen and
  // cilastatin/-statin cases were, just resolved by specificity instead of
  // an explicit exclude list.
  { modality: "CELL_THERAPY", stem: "cabtagene" },

  // Gene therapies — a two-word INN scheme (word 1 = gene component, suffix
  // "-gene"; word 2 = vector component, suffix "-vec"/"-repvec" for viral
  // vectors, "-bac" for bacterial, "-plasmid" for plasmid DNA). Both words
  // land as separate tokens after whitespace splitting, so per-token suffix
  // matching already checks both halves with no special-casing needed.
  { modality: "GENE_THERAPY", stem: "gene" },
  { modality: "GENE_THERAPY", stem: "repvec" },
  { modality: "GENE_THERAPY", stem: "vec" },
  { modality: "GENE_THERAPY", stem: "bac" },
  { modality: "GENE_THERAPY", stem: "plasmid" },

  // Antisense oligonucleotide / siRNA therapeutics.
  { modality: "OLIGONUCLEOTIDE", stem: "rsen" },
  { modality: "OLIGONUCLEOTIDE", stem: "siran" },

  // Peptide hormone/analog stems.
  { modality: "PEPTIDE", stem: "tide" },
  { modality: "PEPTIDE", stem: "relin" },
  { modality: "PEPTIDE", stem: "pressin" },

  // Heparins/heparinoids — sulfated polysaccharides, not peptides and not
  // really "small" molecules either; bucketed as OTHER rather than
  // inventing a dedicated category for a handful of drugs.
  { modality: "OTHER", stem: "parin" },
];

// No INN stem exists for these categories — matched as a whole token
// (Purple Book's own naming convention), not a suffix. "vaccine" gets its
// own dedicated modality (77 real hits, 0 false positives); the other four
// are real, identifiable protein/biologic categories with no naming-stem
// of their own (confirmed dominant patterns among the ~48% of real Purple
// Book names no stem matches — see classifyDrugClass's KEYWORD_RULES,
// which tag the same categories at the drugClass level) — bucketed as
// OTHER rather than left UNCLASSIFIED, the same reasoning already applied
// to Orange Book's heparinoids above: not really any of the specific named
// categories, but a real, known kind of thing, not simply unknown.
const KEYWORD_RULES: { modality: StemModality; keyword: string }[] = [
  { modality: "VACCINE", keyword: "vaccine" },
  { modality: "OTHER", keyword: "antihemophilic" },
  { modality: "OTHER", keyword: "coagulation" },
  { modality: "OTHER", keyword: "immunoglobulin" },
  { modality: "OTHER", keyword: "immunoglobulins" },
  { modality: "OTHER", keyword: "globulin" },
  { modality: "OTHER", keyword: "allergen" },
  { modality: "OTHER", keyword: "allergens" },
  { modality: "OTHER", keyword: "allergenic" },
  { modality: "OTHER", keyword: "antivenin" },
  { modality: "OTHER", keyword: "antitoxin" },
];

// Finds the single longest-matching stem across every token of the whole
// (possibly multi-ingredient) name — not per-token or per-component
// independently. One global "longest/most specific stem wins" rule, rather
// than array declaration order standing in for priority (the previous
// design's actual bug: a new rule inserted in the wrong position could
// silently shadow a more specific one) — and, importantly, rather than a
// per-component "first/last match wins" rule, which gets real gene-therapy
// names wrong: e.g. "elivaldogene autotemcel" (Skysona) has one token
// ending in the gene-therapy stem "gene" (4 chars) and one ending in the
// cell-therapy stem "cel" (3 chars) — these ex-vivo gene therapies
// genuinely modify autologous cells, so the name legitimately carries both
// signals, and FDA classifies the product by its therapeutic mechanism
// (gene therapy) rather than its delivery vehicle (cells). Comparing stem
// length globally gets this right for free, using the exact same
// "specificity" reasoning already applied within a single token, instead
// of needing a separate, hand-maintained modality-vs-modality priority
// table.
function findLongestStemMatch(tokens: string[]): StemRule | null {
  let best: StemRule | null = null;
  for (const token of tokens) {
    for (const rule of STEM_RULES) {
      if (!token.endsWith(rule.stem)) continue;
      if (!best || rule.stem.length > best.stem.length) best = rule;
    }
  }
  return best;
}

// `fallback` is caller-supplied rather than hardcoded, because "no stem
// matched" means something different depending on the regulatory pathway
// the name came from:
//  - Orange Book (NDA/ANDA, small-molecule pathway): the pathway ITSELF is
//    strong independent evidence of small-molecule chemistry, so "no
//    stronger signal" genuinely does mean SMALL_MOLECULE in the vast
//    majority of real cases. Callers pass fallback: "SMALL_MOLECULE".
//  - Purple Book (BLA, biologics pathway): the product is definitely NOT a
//    small molecule (clotting factors, immunoglobulins, allergenic
//    extracts, antivenins have no distinct INN suffix of their own), so
//    assuming SMALL_MOLECULE here would be actively wrong, not just
//    imprecise. Callers pass fallback: "UNCLASSIFIED" — an honest "we
//    don't have a confident tag for this" rather than a wrong guess.
// This is the actual fix for the reported bug: previously the fallback was
// unconditionally SMALL_MOLECULE, which only ever looked correct because
// the classifier had only ever seen Orange Book data.
//
// Combination products need no special-casing here: tokenize() already
// splits on ";" and "," along with whitespace, so every ingredient's
// tokens are already flattened into one array by the time this runs — each
// ingredient still gets checked against every stem individually, just
// without a separate per-component resolution step. Not storing a
// multi-valued result when a name genuinely mixes categories — a single
// best-effort tag (the same precedent as drugClass) is enough, and stem
// length is the tiebreaker (see findLongestStemMatch).
export function classifyModality(genericName: string, fallback: Modality): Modality {
  const tokens = tokenize(genericName);

  const stemMatch = findLongestStemMatch(tokens);
  if (stemMatch) return stemMatch.modality;

  const keywordMatch = KEYWORD_RULES.find((rule) => tokens.includes(rule.keyword));
  if (keywordMatch) return keywordMatch.modality;

  return fallback;
}
