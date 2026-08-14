import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

// The product has two access tiers. "analyst" is Better Auth's admin
// plugin's built-in "admin" role under the hood (see auth.ts) — kept as
// the literal string their plugin's own authorization checks expect,
// renamed only here at the boundary into the product's own language.
export type AccessTier = "subscriber" | "analyst";

const ANALYST_ROLE = "admin";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  tier: AccessTier;
}

function toAccessTier(role: string | null | undefined): AccessTier {
  return role === ANALYST_ROLE ? "analyst" : "subscriber";
}

function toAuthenticatedUser(user: { id: string; name: string; email: string; role?: string | null }): AuthenticatedUser {
  return { id: user.id, name: user.name, email: user.email, tier: toAccessTier(user.role) };
}

// For Server Components and Server Actions, which don't receive a request
// object directly — `next/headers()` reads from Next's ambient
// request-scoped context instead. This only works inside an actual
// Next.js request (real dev/prod server); it throws if called any other
// way, which is deliberate — it's how Next enforces that this is used
// where that context genuinely exists. Wrapped in React's cache() so
// several calls within one render pass (e.g. a layout and a page both
// checking auth) share one session lookup instead of hitting the database
// repeatedly.
export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return toAuthenticatedUser(session.user as { id: string; name: string; email: string; role?: string | null });
});

// For Route Handlers, which — unlike Server Components — already receive
// the request explicitly. Reading its headers directly (rather than going
// through the next/headers() ambient API above) is both more direct and,
// concretely, what makes route handlers testable by calling GET()/POST()
// as plain functions: next/headers() throws "called outside a request
// scope" when there's no real Next.js request context around it, which a
// test invoking a handler directly never has.
export async function getSessionUser(request: Request): Promise<AuthenticatedUser | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  return toAuthenticatedUser(session.user as { id: string; name: string; email: string; role?: string | null });
}

// For Server Component pages. Use in every page that requires the viewer
// to be signed in — proxy.ts only does an optimistic cookie-existence
// check (fast, but forgeable), so this real database-backed check is the
// actual security boundary.
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// For Server Component pages restricted to the "Analyst" tier.
export async function requireAnalyst(): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (user.tier !== "analyst") redirect("/");
  return user;
}
