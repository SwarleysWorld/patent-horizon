"use client";

import { useState } from "react";

type ThemePref = "system" | "light" | "dark";

// Both a cookie AND localStorage, not just one: the cookie is what lets
// `layout.tsx` (a Server Component) render the right class from the very
// first byte of HTML on every subsequent page load — no client-side
// bootstrap script involved at all. A plain <script> placed in the App
// Router's <head> turned out not to work for this (confirmed directly:
// React logs "Scripts inside React components are never executed when
// rendering on the client" and never runs it; next/script's
// `beforeInteractive` strategy queues into a `__next_s` array for Next's
// own runtime to process rather than injecting an immediately-executing
// tag, and in practice never applied the class before paint either).
// localStorage stays too, purely so this button's own label reflects the
// saved choice on the client without waiting on a server round-trip.
function applyTheme(pref: ThemePref) {
  const isDark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
  if (pref === "system") {
    localStorage.removeItem("theme");
    document.cookie = "theme=; path=/; max-age=0";
  } else {
    localStorage.setItem("theme", pref);
    document.cookie = `theme=${pref}; path=/; max-age=31536000; samesite=lax`;
  }
}

const ICONS: Record<ThemePref, React.ReactNode> = {
  system: (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="4" width="18" height="13" rx="1.5" />
      <path strokeLinecap="round" d="M8 21h8M12 17v4" />
    </svg>
  ),
  light: (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="4" />
      <path strokeLinecap="round" d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  ),
  dark: (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
    </svg>
  ),
};

const NEXT: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<ThemePref, string> = { system: "System", light: "Light", dark: "Dark" };

// Class-based dark mode (see globals.css's `@custom-variant dark`), not
// bare `prefers-color-scheme` — this makes it an explicit, visible,
// in-app choice rather than something only noticeable if you happen to
// also flip your OS theme. layout.tsx reads the `theme` cookie server-
// side and puts the `dark` class on <html> directly in the initial HTML
// when it's set, so there's no client-side flash-then-correct step for a
// returning visitor. Initial value here is read synchronously (not via
// useEffect+setState, which would cascade an extra render for no benefit)
// purely so this button's own label is right immediately; server-rendered
// HTML always says "System" (no `window` yet), corrected the moment this
// component hydrates, hence `suppressHydrationWarning` below — a
// one-frame label mismatch, never a layout or color shift.
function initialPref(): ThemePref {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem("theme");
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(initialPref);

  return (
    <button
      onClick={() => {
        const next = NEXT[pref];
        setPref(next);
        applyTheme(next);
      }}
      className="flex items-center gap-1.5 rounded-md border border-paper-200 px-2 py-1 text-xs text-paper-600 hover:bg-paper-100 dark:border-paper-800 dark:text-paper-400 dark:hover:bg-paper-900"
      title="Cycle theme: System → Light → Dark"
    >
      {ICONS[pref]}
      <span suppressHydrationWarning>{LABEL[pref]}</span>
    </button>
  );
}
