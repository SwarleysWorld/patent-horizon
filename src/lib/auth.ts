import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "./prisma";
import { parseAnalystAllowlist, isAnalystEmail } from "./analystAllowlist";
import { parseSignupAllowlist, isAuthorizedToSignUp } from "./signupAllowlist";

// Emails that should be granted the elevated (admin/"Analyst") role the
// moment they sign up, instead of the default "user"/"Subscriber" role.
// This is how the founder's own account — and any future employee's —
// gets analyst access without a manual database edit. A user not on this
// list can still be promoted later from /team by an existing analyst.
const ANALYST_EMAILS = parseAnalystAllowlist(process.env.ANALYST_EMAILS);

// Closed-beta gate: only these emails (plus every ANALYST_EMAILS entry, so
// the operator can never lock themselves out by forgetting to list an
// address twice) can create an account at all. See signupAllowlist.ts.
const SIGNUP_ALLOWLIST = new Set([
  ...parseSignupAllowlist(process.env.AUTHORIZED_SIGNUP_EMAILS),
  ...ANALYST_EMAILS,
]);

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  emailAndPassword: {
    enabled: true,
    // Slightly above the library default (8) — no email verification or
    // rate-limited login exists yet (see README), so a stronger minimum is
    // a cheap partial mitigation against credential-stuffing / weak
    // passwords until that's built.
    minPasswordLength: 10,
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!isAuthorizedToSignUp(user.email, SIGNUP_ALLOWLIST)) {
            throw new APIError("BAD_REQUEST", {
              message: "This email isn't authorized to sign up. Contact us for access.",
            });
          }
          const role = isAnalystEmail(user.email, ANALYST_EMAILS) ? "admin" : "user";
          return { data: { ...user, role } };
        },
      },
    },
  },

  // The admin plugin gives us: a `role` field on the user (default "user",
  // "admin" for the elevated tier — see requireAnalyst() in
  // src/lib/session.ts for how this maps to "Subscriber"/"Analyst" in the
  // product), plus battle-tested user-management endpoints (list, set
  // role, set password, remove) used by /team instead of hand-rolled
  // equivalents.
  //
  // nextCookies() must be last — it auto-applies Set-Cookie headers when
  // auth methods are called from Server Actions (see Better Auth's
  // Next.js integration docs).
  plugins: [admin(), nextCookies()],
});
