/**
 * Token storage.
 *
 * SECURITY TRADE-OFF — READ BEFORE CHANGING
 * -----------------------------------------
 * The access token lives in a module-level variable (memory only). It is never
 * written to localStorage, so an XSS payload cannot simply read it out of storage
 * — it would have to execute inside our bundle's scope during a live session.
 *
 * The refresh token IS in localStorage, because the backend does not yet set
 * httpOnly cookies and a refresh token has to survive a page reload. This is the
 * weak link: an XSS payload can read it and mint access tokens until it expires
 * or is revoked. We accept that consciously, and we mitigate what we can — the
 * backend stores only a *digest* of each refresh token and supports revocation
 * (see backend/app/models/user.py RefreshToken), so a stolen token can be killed.
 *
 * PRODUCTION HARDENING (the intended next step, backend work):
 *   1. Backend sets the refresh token as `Set-Cookie: HttpOnly; Secure;
 *      SameSite=Strict; Path=/graphql` on login/refresh.
 *   2. Client sends `credentials: "include"` and stops touching localStorage.
 *   3. Delete `getRefreshToken`/`setRefreshToken` below; the refresh mutation
 *      takes no argument and reads the cookie server-side.
 * The rest of this file — and every caller — stays the same.
 */

const REFRESH_TOKEN_KEY = "cms.refresh_token";

/**
 * A NON-httpOnly, non-sensitive marker cookie. It holds no token — just "a
 * session probably exists" — so `middleware.ts` (which runs on the edge and can
 * only see cookies) can bounce logged-out users before we ship them a dashboard
 * shell. It is a UX optimisation, NOT a security boundary: the GraphQL API is the
 * only thing that actually authorises anything.
 */
const SESSION_HINT_COOKIE = "cms_session";

let accessToken: string | null = null;

// ---------------------------------------------------------------------------
// Access token (memory)
// ---------------------------------------------------------------------------
export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

// ---------------------------------------------------------------------------
// Refresh token (localStorage — see the XSS note above)
// ---------------------------------------------------------------------------
export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    // Safari private mode throws on localStorage access.
    return null;
  }
}

export function setRefreshToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
    else window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    /* storage unavailable — the session simply won't survive a reload */
  }
}

// ---------------------------------------------------------------------------
// Session hint cookie (for middleware only)
// ---------------------------------------------------------------------------
export function setSessionHint(active: boolean): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = active
    ? `${SESSION_HINT_COOKIE}=1; Path=/; Max-Age=2592000; SameSite=Lax${secure}`
    : `${SESSION_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

export const SESSION_COOKIE_NAME = SESSION_HINT_COOKIE;

// ---------------------------------------------------------------------------
// Combined
// ---------------------------------------------------------------------------
export function setTokens(tokens: { accessToken: string; refreshToken: string }): void {
  setAccessToken(tokens.accessToken);
  setRefreshToken(tokens.refreshToken);
  setSessionHint(true);
}

export function clearTokens(): void {
  setAccessToken(null);
  setRefreshToken(null);
  setSessionHint(false);
}

/**
 * True when a reload *might* be resumable — i.e. we still hold a refresh token.
 * The access token is always null after a reload (it was in memory), so this is
 * what AuthProvider checks before deciding to attempt a silent restore.
 */
export function hasPersistedSession(): boolean {
  return getRefreshToken() !== null;
}
