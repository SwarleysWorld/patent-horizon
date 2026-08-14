// Split out from auth.ts purely so this can be unit-tested without pulling
// in the database/auth stack — it's plain string logic.

export function parseAnalystAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAnalystEmail(email: string, allowlist: Set<string>): boolean {
  return allowlist.has(email.trim().toLowerCase());
}
