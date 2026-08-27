import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, createTestUser } from "./helpers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { parseAnalystAllowlist, isAnalystEmail } from "@/lib/analystAllowlist";
import { parseSignupAllowlist, isAuthorizedToSignUp } from "@/lib/signupAllowlist";

beforeEach(async () => {
  await resetDb();
});

describe("parseAnalystAllowlist / isAnalystEmail", () => {
  it("parses a comma-separated list, trimmed and lowercased", () => {
    const list = parseAnalystAllowlist(" Alice@Example.com, bob@example.com ,,");
    expect(isAnalystEmail("alice@example.com", list)).toBe(true);
    expect(isAnalystEmail("ALICE@EXAMPLE.COM", list)).toBe(true);
    expect(isAnalystEmail("bob@example.com", list)).toBe(true);
    expect(isAnalystEmail("carol@example.com", list)).toBe(false);
  });

  it("treats undefined/empty as an empty allowlist — no email matches", () => {
    expect(isAnalystEmail("anyone@example.com", parseAnalystAllowlist(undefined))).toBe(false);
    expect(isAnalystEmail("anyone@example.com", parseAnalystAllowlist(""))).toBe(false);
  });
});

describe("parseSignupAllowlist / isAuthorizedToSignUp", () => {
  it("authorizes an exact email match, trimmed and case-insensitive", () => {
    const list = parseSignupAllowlist(" Alice@Example.com, bob@example.com ,,");
    expect(isAuthorizedToSignUp("alice@example.com", list)).toBe(true);
    expect(isAuthorizedToSignUp("ALICE@EXAMPLE.COM", list)).toBe(true);
    expect(isAuthorizedToSignUp("carol@example.com", list)).toBe(false);
  });

  it("authorizes an entire domain via an @domain entry", () => {
    const list = parseSignupAllowlist("@acme.com");
    expect(isAuthorizedToSignUp("anyone@acme.com", list)).toBe(true);
    expect(isAuthorizedToSignUp("Someone.Else@ACME.com", list)).toBe(true);
    expect(isAuthorizedToSignUp("anyone@other.com", list)).toBe(false);
  });

  it("fails closed: undefined/empty means nobody is authorized", () => {
    expect(isAuthorizedToSignUp("anyone@example.com", parseSignupAllowlist(undefined))).toBe(false);
    expect(isAuthorizedToSignUp("anyone@example.com", parseSignupAllowlist(""))).toBe(false);
  });
});

describe("signup allowlist enforcement", () => {
  it("rejects a signup whose email isn't authorized", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { email: "not-authorized@not-example.com", password: "TestPassword123!", name: "Nope" },
      }),
    ).rejects.toThrow();
  });
});

describe("signup role assignment", () => {
  it("defaults new users to the subscriber tier (role='user')", async () => {
    const res = await auth.api.signUpEmail({
      body: { email: "new-signup@example.com", password: "TestPassword123!", name: "New Person" },
    });
    expect(res.user.role).toBe("user");
  });

  // ANALYST_EMAILS is intentionally empty in .env.test (see helpers.ts) so
  // this behavior is covered as a pure function above instead of an
  // env-var-dependent integration test; verified manually end-to-end
  // against the real ANALYST_EMAILS-configured dev server too (see README).
});

describe("getSessionUser", () => {
  it("returns null when there's no session cookie", async () => {
    const req = new NextRequest("http://localhost:3000/api/drugs");
    expect(await getSessionUser(req)).toBeNull();
  });

  it("returns tier 'subscriber' for a default-role user", async () => {
    const user = await createTestUser({ tier: "subscriber" });
    const req = new NextRequest("http://localhost:3000/api/drugs", { headers: { cookie: user.cookie } });
    const result = await getSessionUser(req);
    expect(result?.tier).toBe("subscriber");
    expect(result?.id).toBe(user.userId);
  });

  it("returns tier 'analyst' for an admin-role user", async () => {
    const user = await createTestUser({ tier: "analyst" });
    const req = new NextRequest("http://localhost:3000/api/drugs", { headers: { cookie: user.cookie } });
    const result = await getSessionUser(req);
    expect(result?.tier).toBe("analyst");
  });

  it("returns null for a garbage cookie value (not a real session)", async () => {
    const req = new NextRequest("http://localhost:3000/api/drugs", {
      headers: { cookie: "better-auth.session_token=not-a-real-token" },
    });
    expect(await getSessionUser(req)).toBeNull();
  });
});

// These exercise the actual mechanism the /team Server Actions call
// (auth.api.setRole / setUserPassword / removeUser) with real sessions,
// which is the security-critical part: can an analyst perform these, and
// is a subscriber genuinely refused. The Server Actions' own thin wrapper
// (requireAnalyst() re-check + the self-demotion/self-removal guards) is
// covered by manual testing, not here — Server Actions rely on Next's
// ambient request context (next/headers()), which only exists inside a
// real Next.js request and can't be constructed by calling the action
// function directly in Vitest. See README's "Web auth" section.
describe("Better Auth admin API authorization (via auth.api, with a real session)", () => {
  it("an analyst can change another user's role", async () => {
    const analyst = await createTestUser({ tier: "analyst" });
    const subscriber = await createTestUser({ tier: "subscriber" });

    await auth.api.setRole({
      body: { userId: subscriber.userId, role: "admin" },
      headers: new Headers({ cookie: analyst.cookie }),
    });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: subscriber.userId } });
    expect(updated.role).toBe("admin");
  });

  it("a subscriber cannot change anyone's role", async () => {
    const subscriber = await createTestUser({ tier: "subscriber" });
    const other = await createTestUser({ tier: "subscriber" });

    await expect(
      auth.api.setRole({
        body: { userId: other.userId, role: "admin" },
        headers: new Headers({ cookie: subscriber.cookie }),
      }),
    ).rejects.toThrow();

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: other.userId } });
    expect(unchanged.role).toBe("user");
  });

  it("an analyst can set another user's password", async () => {
    const analyst = await createTestUser({ tier: "analyst" });
    const subscriber = await createTestUser({ tier: "subscriber" });

    await auth.api.setUserPassword({
      body: { userId: subscriber.userId, newPassword: "BrandNewPassword123!" },
      headers: new Headers({ cookie: analyst.cookie }),
    });

    // Prove it actually took effect: sign in with the new password.
    const userRow = await prisma.user.findUniqueOrThrow({ where: { id: subscriber.userId } });
    const signIn = await auth.api.signInEmail({
      body: { email: userRow.email, password: "BrandNewPassword123!" },
    });
    expect(signIn.user.id).toBe(subscriber.userId);
  });

  it("a subscriber cannot set another user's password", async () => {
    const subscriber = await createTestUser({ tier: "subscriber" });
    const other = await createTestUser({ tier: "subscriber" });

    await expect(
      auth.api.setUserPassword({
        body: { userId: other.userId, newPassword: "ShouldNotWork123!" },
        headers: new Headers({ cookie: subscriber.cookie }),
      }),
    ).rejects.toThrow();
  });

  it("an analyst can remove a user", async () => {
    const analyst = await createTestUser({ tier: "analyst" });
    const subscriber = await createTestUser({ tier: "subscriber" });

    await auth.api.removeUser({
      body: { userId: subscriber.userId },
      headers: new Headers({ cookie: analyst.cookie }),
    });

    const found = await prisma.user.findUnique({ where: { id: subscriber.userId } });
    expect(found).toBeNull();
  });

  it("a subscriber cannot remove a user", async () => {
    const subscriber = await createTestUser({ tier: "subscriber" });
    const other = await createTestUser({ tier: "subscriber" });

    await expect(
      auth.api.removeUser({
        body: { userId: other.userId },
        headers: new Headers({ cookie: subscriber.cookie }),
      }),
    ).rejects.toThrow();

    const stillThere = await prisma.user.findUnique({ where: { id: other.userId } });
    expect(stillThere).not.toBeNull();
  });
});
