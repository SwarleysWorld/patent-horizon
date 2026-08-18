// Shared by modality.ts and drugClass.ts. An ingredient field can list
// multiple active ingredients ("AMLODIPINE BESYLATE; VALSARTAN") and each
// ingredient is itself often "ACTIVE_INGREDIENT SALT_FORM" ("ENOXAPARIN
// SODIUM"). Classification stems apply to the active-ingredient word
// itself, and matching per-token (rather than substring-anywhere over the
// whole string) is what keeps a word like "ARSENIC" from spuriously
// matching a "-rsen" oligonucleotide stem — "arsenic" doesn't *end* in
// "rsen", it just contains those letters in the middle.

// Common salt/ester-form and hydration-state modifier words that get
// appended to an active-ingredient name and would otherwise become their
// own (unclassifiable, and potentially stem-colliding) token — e.g.
// "atorvastatin CALCIUM" or "sildenafil CITRATE". This is the tractable
// slice of "strip ester forms": recognizing the modifier WORD that's
// tacked on, not de-esterifying a prodrug baked into the INN itself (e.g.
// "enalapril" is chemically an ester of "enalaprilat", but that's a
// pharmacology fact, not a naming-convention pattern — out of scope here).
// A bounded, known list (not exhaustive of every salt ever used, but the
// common ones), checked as an EXACT token match, never a suffix match —
// unlike classification stems, these are always their own separate word.
const SALT_AND_HYDRATE_FORMS = new Set([
  // metal/ammonium salts
  "sodium", "potassium", "calcium", "magnesium", "zinc", "lithium", "aluminum", "ammonium",
  "disodium", "dipotassium",
  // halide salts
  "hydrochloride", "hcl", "hydrobromide", "hbr", "hydriodide", "bromide", "chloride", "iodide",
  // sulfonate salts
  "besylate", "besilate", "mesylate", "mesilate", "tosylate", "tosilate", "esylate",
  "edisylate", "edisilate", "camsylate", "camsilate", "napsylate", "napsilate",
  // carboxylate / organic-acid salts
  "maleate", "fumarate", "succinate", "tartrate", "citrate", "acetate", "sulfate", "sulphate",
  "phosphate", "nitrate", "gluconate", "lactate", "malate", "oxalate", "benzoate", "palmitate",
  "stearate", "valerate", "propionate", "dipropionate", "diproprionate", "decanoate", "enanthate",
  "cypionate", "pivalate", "furoate", "pamoate", "embonate", "edetate", "xinafoate",
  // amine / amino-acid salts
  "trometamol", "tromethamine", "meglumine", "lysine", "arginine",
  // hydration state
  "monohydrate", "dihydrate", "trihydrate", "hemihydrate", "anhydrous",
]);

export function tokenize(genericName: string): string[] {
  return genericName
    .toLowerCase()
    .split(/[\s;,()/]+/)
    .map((token) => token.replace(/[^a-z]/g, ""))
    .filter(Boolean)
    .filter((token) => !SALT_AND_HYDRATE_FORMS.has(token));
}
