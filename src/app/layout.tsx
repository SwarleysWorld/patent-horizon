import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Serif, IBM_Plex_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/session";
import { Sidebar } from "@/components/layout/Sidebar";
import "./globals.css";

// One coherent type system, not three unrelated picks — IBM Plex was
// designed as a single family for technical/enterprise contexts. Serif
// for display/headings (institutional-document character, moderate
// stroke contrast), Sans for body/UI chrome, Mono for every date/patent-
// number/code/figure — see design plan for the full rationale.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexSerif = IBM_Plex_Serif({
  variable: "--font-plex-serif",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Patent Horizon",
  description:
    "Track pharmaceutical patent expirations and time generic drug market entry.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Display-only — never treat this as the access control. See
  // src/lib/session.ts: the real enforcement is requireUser()/
  // requireAnalyst() in each protected page and API route.
  const user = await getCurrentUser();

  // ThemeToggle writes this cookie alongside localStorage whenever
  // someone picks Light/Dark explicitly — reading it here means the very
  // first byte of HTML already has the right class, no client-side
  // bootstrap script or post-hydration correction needed. No cookie
  // (never chosen, or explicitly set back to "System") falls back to
  // light; there's no server-side way to read a visitor's OS preference,
  // so a first-time visitor whose OS prefers dark sees light until they
  // use the toggle — a one-time, honest tradeoff, not a bug.
  const themeCookie = (await cookies()).get("theme")?.value;
  const isDark = themeCookie === "dark";

  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexSerif.variable} ${plexMono.variable} h-full antialiased${isDark ? " dark" : ""}`}
    >
      <body className="flex min-h-full flex-col sm:flex-row">
        <Sidebar user={user} />
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
