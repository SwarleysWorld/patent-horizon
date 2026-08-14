import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Next.js 16 renamed "middleware" to "proxy" (same mechanism). This is
// deliberately only an optimistic, cookie-existence check — fast, runs on
// every request, but NOT the real security boundary (a forged cookie
// would pass this check). The actual enforcement is the database-backed
// getSession() call in requireUser()/requireAnalyst() (src/lib/session.ts),
// used by every protected page and API route. This proxy exists purely so
// a signed-out visitor gets redirected before the app renders anything,
// rather than after.
const PUBLIC_PATHS = ["/login", "/signup"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));
  const isPublicPath = PUBLIC_PATHS.includes(pathname);

  if (!hasSession && !isPublicPath) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSession && isPublicPath) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
