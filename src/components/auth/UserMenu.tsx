"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import type { AuthenticatedUser } from "@/lib/session";

export function UserMenu({ user }: { user: AuthenticatedUser | null }) {
  const router = useRouter();

  if (!user) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <Link href="/login" className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          Sign in
        </Link>
        <Link
          href="/signup"
          className="rounded-md bg-zinc-900 px-2.5 py-1 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Sign up
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      {user.tier === "analyst" && (
        <>
          <Link href="/data" className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
            Data
          </Link>
          <Link href="/team" className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
            Team
          </Link>
        </>
      )}
      <span
        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 ring-1 ring-inset ring-zinc-300 dark:text-zinc-400 dark:ring-zinc-700"
        title={user.email}
      >
        {user.tier === "analyst" ? "Analyst" : "Subscriber"}
      </span>
      <span className="hidden text-zinc-500 sm:inline dark:text-zinc-400">{user.name}</span>
      <button
        onClick={async () => {
          await authClient.signOut();
          router.push("/login");
          router.refresh();
        }}
        className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        Sign out
      </button>
    </div>
  );
}
