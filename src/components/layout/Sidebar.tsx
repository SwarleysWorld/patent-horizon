"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { UserMenu } from "@/components/auth/UserMenu";
import { ThemeToggle } from "./ThemeToggle";
import type { AuthenticatedUser } from "@/lib/session";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/drugs", label: "Search" },
  { href: "/watchlist", label: "Watchlist" },
] as const;

const ANALYST_NAV_ITEMS = [
  { href: "/data", label: "Data" },
  { href: "/team", label: "Team" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-ledger-50 text-ledger-700 dark:bg-ledger-500/10 dark:text-ledger-400"
          : "text-paper-600 hover:bg-paper-100 hover:text-paper-900 dark:text-paper-400 dark:hover:bg-paper-900 dark:hover:text-paper-100",
      )}
    >
      {label}
    </Link>
  );
}

export function Sidebar({ user }: { user: AuthenticatedUser | null }) {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop: fixed left sidebar. */}
      <aside className="hidden w-56 shrink-0 flex-col justify-between border-r border-paper-200 px-3 py-4 sm:flex dark:border-paper-800">
        <div className="flex flex-col gap-6">
          <Link href="/" className="font-serif px-2 text-base font-semibold tracking-tight">
            Patent Horizon
          </Link>
          <nav className="flex flex-col gap-0.5">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.href} {...item} active={isActive(pathname, item.href)} />
            ))}
            {user?.tier === "analyst" && (
              <>
                <div className="my-2 border-t border-paper-200 dark:border-paper-800" />
                {ANALYST_NAV_ITEMS.map((item) => (
                  <NavLink key={item.href} {...item} active={isActive(pathname, item.href)} />
                ))}
              </>
            )}
          </nav>
        </div>
        <div className="flex flex-col gap-3 border-t border-paper-200 px-2 pt-3 dark:border-paper-800">
          <ThemeToggle />
          <UserMenu user={user} />
        </div>
      </aside>

      {/* Mobile: compact top bar — a full vertical sidebar doesn't fit narrow viewports. */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-paper-200 px-4 sm:hidden dark:border-paper-800">
        <Link href="/" className="font-serif text-sm font-semibold tracking-tight">
          Patent Horizon
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/" className="text-paper-600 dark:text-paper-400">
            Home
          </Link>
          <Link href="/drugs" className="text-paper-600 dark:text-paper-400">
            Search
          </Link>
          <Link href="/watchlist" className="text-paper-600 dark:text-paper-400">
            Watchlist
          </Link>
          <ThemeToggle />
          <UserMenu user={user} />
        </nav>
      </header>
    </>
  );
}
