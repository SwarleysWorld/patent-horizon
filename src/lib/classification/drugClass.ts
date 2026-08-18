import { tokenize } from "./tokenize";

interface StemClassRule {
  label: string;
  stems: string[];
  // Ingredient tokens that would otherwise match a stem but genuinely
  // aren't in that class — coincidental naming, not a real exception to
  // the pharmacology. Found by checking real matches against this
  // project's data before shipping the rule (see README).
  exclude?: string[];
}

// A small, curated, best-effort set of mechanism/therapeutic-class tags —
// deliberately not an attempt at a comprehensive pharmacology taxonomy.
// Every stem here was checked against this project's real ~2,739 distinct
// Orange Book ingredient names before being added (not just assumed from
// general naming-convention knowledge), specifically to catch cases like
// these: "-statin" alone would also tag cilastatin (a renal enzyme
// inhibitor, not a cholesterol drug), nystatin (an antifungal), and
// pentostatin (an oncology drug) — none of which are actually statins,
// despite the matching suffix. Add more classes by the same process: match
// the stem against real data first, then decide what needs excluding.
const STEM_RULES: StemClassRule[] = [
  { label: "Statin", stems: ["statin"], exclude: ["cilastatin", "nystatin", "pentostatin"] },
  { label: "Angiotensin receptor blocker (ARB)", stems: ["sartan"] },
  { label: "ACE inhibitor", stems: ["pril"] },
  { label: "Beta blocker", stems: ["olol"] },
  { label: "Kinase inhibitor", stems: ["tinib"] },
  { label: "CDK4/6 inhibitor", stems: ["ciclib"] },
  { label: "SGLT2 inhibitor", stems: ["gliflozin"] },
  { label: "DPP-4 inhibitor", stems: ["gliptin"] },
  { label: "Penicillin-class antibiotic", stems: ["cillin"] },
];

// Purple Book has no suffix-naming convention for these categories the way
// small molecules and the newer biologic modalities do (no INN stem for
// "this is a clotting factor") — but the category is plainly stated in the
// Proper Name itself. Keyword rules match a WHOLE token (like the
// modality-classifier's "vaccine" rule), not a suffix. Checked against the
// 658 real Purple Book Proper Name values: without these, 48% of Purple
// Book products would have no drugClass tag at all despite the category
// being right there in the name — these four cover a large share of that
// gap (clotting factors, immunoglobulins, allergenic extracts,
// antivenoms/antitoxins were the dominant recurring patterns found).
interface KeywordClassRule {
  label: string;
  keywords: string[]; // any one present anywhere in the tokenized name is a match
}

const KEYWORD_RULES: KeywordClassRule[] = [
  { label: "Clotting factor", keywords: ["antihemophilic", "coagulation"] },
  { label: "Immunoglobulin", keywords: ["immunoglobulin", "immunoglobulins", "globulin"] },
  { label: "Allergenic extract", keywords: ["allergen", "allergens", "allergenic"] },
  { label: "Antivenom / antitoxin", keywords: ["antivenin", "antitoxin"] },
];

export const DRUG_CLASS_LABELS: string[] = [...STEM_RULES.map((r) => r.label), ...KEYWORD_RULES.map((r) => r.label)];

// A drug/biologic can reasonably belong to more than one tagged class (a
// combination product, or something that's both e.g. an ARB and something
// else) — but the schema stores one best-effort tag, so this returns the
// first match in priority order (stem rules first, then keyword rules),
// consistent with classifyModality's approach. Returns null (not a
// sentinel string) when nothing matches, since "no confident class tag" is
// a different, more honest claim than "small molecule" is for modality.
export function classifyDrugClass(name: string): string | null {
  const tokens = tokenize(name);

  for (const rule of STEM_RULES) {
    const excluded = new Set(rule.exclude ?? []);
    const matches = tokens.some(
      (token) => !excluded.has(token) && rule.stems.some((stem) => token.endsWith(stem)),
    );
    if (matches) return rule.label;
  }

  for (const rule of KEYWORD_RULES) {
    if (tokens.some((token) => rule.keywords.includes(token))) return rule.label;
  }

  return null;
}
