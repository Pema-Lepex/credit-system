
import { NextResponse, type NextRequest } from "next/server";

/**
 * Route guard.
 *
 * SCOPE: this is a *UX* guard, not a security boundary. Middleware runs on the
 * edge and can only read cookies; our access token lives in memory and our
 * refresh token in localStorage (see lib/auth/tokens.ts), neither of which is
 * visible here. So we read `cms_session` — a non-httpOnly marker cookie that
 * carries no token and only says "a session probably exists".
 *
 * That is enough to stop a logged-out visitor being shown a dashboard skeleton
 * before the client-side auth check resolves. Every byte of real data still comes
 * from the GraphQL API, which authorises each request against a real JWT. Forging
 * the cookie gets you an empty shell and a wall of 401s.
 *
 * When the backend moves to httpOnly refresh cookies, this becomes a genuine check.
 */

const SESSION_COOKIE = "cms_session";

/** Auth screens: reachable logged-out, and pointless logged-in (bounce to app). */
const AUTH_ROUTES = ["/login", "/register", "/forgot-password", "/reset-password"];

/** Reachable in either state — never require a session, never bounce away. */
const OPEN_ROUTES = ["/terms", "/privacy", "/guide"];

function matches(pathname: string, routes: readonly string[]): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.get(SESSION_COOKIE)?.value === "1";

  if (matches(pathname, OPEN_ROUTES)) return NextResponse.next();

  if (matches(pathname, AUTH_ROUTES)) {
    // Already signed in? Don't make them look at the login form.
    if (hasSession) return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
  }

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    // Round-trip the intended destination so login can send them onward.
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Everything except Next internals, static assets, and any path with a file
   * extension. Keeping images/fonts out of the matcher matters: running middleware
   * on every asset is a measurable cold-start tax on the edge.
   */
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
