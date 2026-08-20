"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import type { AuthenticatedUser } from "@/lib/session";

// Account-area widget — sits at the bottom of the sidebar. Navigation
// (Home/Search/Watchlist/Data/Team) lives in Sidebar.tsx, not here; this
// is purely "who am I signed in as, and sign out."
export function UserMenu({ user }: { user: AuthenticatedUser | null }) {
  const router = useRouter();

  if (!user) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <Link href="/login" className="text-paper-600 hover:text-paper-900 dark:text-paper-400 dark:hover:text-paper-100">
          Sign in
        </Link>
        <Link
          href="/signup"
          className="rounded-md bg-paper-900 px-2.5 py-1 font-medium text-paper-50 hover:bg-paper-700 dark:bg-paper-100 dark:text-paper-900 dark:hover:bg-paper-300"
        >
          Sign up
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-paper-500 ring-1 ring-inset ring-paper-300 dark:text-paper-400 dark:ring-paper-700"
          title={user.email}
        >
          {user.tier === "analyst" ? "Analyst" : "Subscriber"}
        </span>
        <span className="truncate text-paper-600 dark:text-paper-400">{user.name}</span>
      </div>
      <button
        onClick={async () => {
          await authClient.signOut();
          router.push("/login");
          router.refresh();
        }}
        className="text-left text-paper-500 hover:text-paper-900 dark:text-paper-400 dark:hover:text-paper-100"
      >
        Sign out
      </button>
    </div>
  );
}
