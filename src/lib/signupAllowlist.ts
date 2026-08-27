// Emails allowed to create an account at all — separate from
// ANALYST_EMAILS, which only controls the elevated role a signup gets.
// Fails closed: an empty/unset list means nobody can sign up (this is a
// closed-beta gate, not an optional feature). Kept as its own tiny module
// so it can be unit-tested without pulling in the full better-auth stack.
//
// An entry starting with "@" authorizes an entire domain (e.g. "@acme.com"
// matches anyone@acme.com) instead of one address.
export function parseSignupAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAuthorizedToSignUp(email: string, allowlist: Set<string>): boolean {
  const normalized = email.trim().toLowerCase();
  if (allowlist.has(normalized)) return true;
  const at = normalized.indexOf("@");
  return at !== -1 && allowlist.has(normalized.slice(at));
}
