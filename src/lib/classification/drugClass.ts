import { tokenize } from "./tokenize";

interface ClassRule {
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
// ingredient names before being added (not just assumed from general
// naming-convention knowledge), specifically to catch cases like these:
// "-statin" alone would also tag cilastatin (a renal enzyme inhibitor, not
// a cholesterol drug), nystatin (an antifungal), and pentostatin (an
// oncology drug) — none of which are actually statins, despite the
// matching suffix. Add more classes by the same process: match the stem
// against real data first, then decide what needs excluding.
const RULES: ClassRule[] = [
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

export const DRUG_CLASS_LABELS: string[] = RULES.map((r) => r.label);

// A drug can reasonably belong to more than one tagged class (a
// combination product, or a drug that's both e.g. an ARB and something
// else) — but the schema stores one best-effort tag per Drug, so this
// returns the first match in priority order, consistent with
// classifyModality's approach. Returns null (not a sentinel string) when
// nothing matches, since "no confident class tag" is a different, more
// honest claim than "small molecule" is for modality — the vast majority
// of small molecules simply aren't in one of these specific named classes.
export function classifyDrugClass(genericName: string): string | null {
  const tokens = tokenize(genericName);
  for (const rule of RULES) {
    const excluded = new Set(rule.exclude ?? []);
    const matches = tokens.some(
      (token) => !excluded.has(token) && rule.stems.some((stem) => token.endsWith(stem)),
    );
    if (matches) return rule.label;
  }
  return null;
}
