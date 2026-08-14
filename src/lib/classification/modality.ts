import { tokenize } from "./tokenize";

export type DrugModality = "SMALL_MOLECULE" | "PEPTIDE" | "OLIGONUCLEOTIDE" | "MONOCLONAL_ANTIBODY" | "OTHER";

export const MODALITY_LABELS: Record<DrugModality, string> = {
  SMALL_MOLECULE: "Small molecule",
  PEPTIDE: "Peptide",
  OLIGONUCLEOTIDE: "Oligonucleotide",
  MONOCLONAL_ANTIBODY: "Monoclonal antibody",
  OTHER: "Other / complex molecule",
};

interface StemRule {
  modality: Exclude<DrugModality, "SMALL_MOLECULE">;
  // Suffixes checked against each whitespace/punctuation-separated token
  // of the ingredient field, per WHO INN / USAN stem conventions.
  stems: string[];
}

// Checked in order — the first rule with a matching token wins, so more
// specific/reliable stems should come first. Verified against this
// project's real ingredient data (2,739 distinct genericName values) before
// being added; see README "Advanced search" section for the false
// positives that were caught and excluded along the way.
const RULES: StemRule[] = [
  // "-mab" is the INN stem for monoclonal antibodies. In practice this
  // matches ~nothing in our data — Orange Book doesn't cover biologics
  // (BLA applications), which is where virtually all real mAbs live. Kept
  // so the classification (and the UI's "0 results, here's why" state) is
  // ready the day a biologics source ever gets ingested.
  { modality: "MONOCLONAL_ANTIBODY", stems: ["mab"] },

  // Antisense oligonucleotide / siRNA therapeutics — a newer drug class
  // with very distinctive, low-false-positive stems.
  { modality: "OLIGONUCLEOTIDE", stems: ["rsen", "siran"] },

  // Peptide hormone/analog stems. "-tide" (semaglutide, liraglutide,
  // linaclotide, ...), "-relin" (GnRH analogs), "-pressin" (vasopressin
  // analogs) — all verified clean (no false positives found) against the
  // real data.
  { modality: "PEPTIDE", stems: ["tide", "relin", "pressin"] },

  // Heparins/heparinoids ("-parin": enoxaparin, dalteparin, ...) — not
  // peptides (they're sulfated polysaccharides) and not really "small"
  // molecules either. Bucketed as OTHER rather than inventing a dedicated
  // category for ~9 drugs.
  { modality: "OTHER", stems: ["parin"] },
];

// Everything not matched by a rule above defaults to SMALL_MOLECULE — not
// a hedge, but a positive classification: Orange Book's NDA/ANDA data is
// overwhelmingly conventional small-molecule chemistry, so "no stronger
// signal" genuinely does mean small molecule in the vast majority of
// cases. This is a heuristic, not authoritative — false negatives (a real
// peptide/biologic missed because it doesn't match a known stem) are
// possible for ingredients that don't follow standard INN naming.
export function classifyModality(genericName: string): DrugModality {
  const tokens = tokenize(genericName);
  for (const rule of RULES) {
    if (tokens.some((token) => rule.stems.some((stem) => token.endsWith(stem)))) {
      return rule.modality;
    }
  }
  return "SMALL_MOLECULE";
}
