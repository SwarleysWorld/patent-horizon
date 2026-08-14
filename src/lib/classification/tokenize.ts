// Shared by modality.ts and drugClass.ts. An ingredient field can list
// multiple active ingredients ("AMLODIPINE BESYLATE; VALSARTAN") and each
// ingredient is itself often "ACTIVE_INGREDIENT SALT_FORM" ("ENOXAPARIN
// SODIUM"). Classification stems apply to the active-ingredient word
// itself, and matching per-token (rather than substring-anywhere over the
// whole string) is what keeps a word like "ARSENIC" from spuriously
// matching a "-rsen" oligonucleotide stem — "arsenic" doesn't *end* in
// "rsen", it just contains those letters in the middle.
export function tokenize(genericName: string): string[] {
  return genericName
    .toLowerCase()
    .split(/[\s;,()/]+/)
    .map((token) => token.replace(/[^a-z]/g, ""))
    .filter(Boolean);
}
