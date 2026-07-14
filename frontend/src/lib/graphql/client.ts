/**
 * GraphQL transport.
 *
 * Deliberately UNTYPED-BY-CODEGEN: the backend schema does not exist yet, so
 * there is nothing to generate from. Feature agents call
 * `gqlRequest<TData, TVars>(document, variables)` and supply the result type
 * themselves. When the schema lands, this file is the single place to bolt
 * graphql-codegen on — no call site changes.
 *
 * The interesting part is the 401 path. Five queries mounting at once will all
 * 401 at once; naively that fires five refreshes, four of which race and (with a
 * rotating-refresh-token backend) invalidate each other. So a single in-flight
 * refresh promise is shared by every waiter, retried once, and on failure the
 * session is cleared and the user is bounced to /login.
 */

import { ClientError, GraphQLClient, type Variables } from "graphql-request";

import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "@/lib/auth/tokens";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const GRAPHQL_ENDPOINT = `${API_URL.replace(/\/$/, "")}/graphql`;

/** Public routes must never be bounced to /login — that is a redirect loop. */
const PUBLIC_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];

const UNAUTHENTICATED_CODES = new Set([
  "UNAUTHENTICATED",
  "UNAUTHORIZED",
  "FORBIDDEN_TOKEN_EXPIRED",
  "TOKEN_EXPIRED",
]);

/**
 * The one mutation this layer knows about. Everything else is caller-supplied.
 * When the backend moves the refresh token to an httpOnly cookie, drop the
 * argument and add `credentials: "include"` — nothing else here changes.
 */
const REFRESH_MUTATION = /* GraphQL */ `
  mutation RefreshToken($refreshToken: String!) {
    refreshToken(refreshToken: $refreshToken) {
      accessToken
      refreshToken
    }
  }
`;

interface RefreshResult {
  refreshToken: {
    accessToken: string;
    refreshToken: string;
  };
}

export interface GqlRequestOptions {
  /** Skip the Authorization header (login, register, forgot-password). */
  anonymous?: boolean;
  /** Skip the auto-refresh-and-retry dance. Set on the refresh call itself. */
  skipAuthRefresh?: boolean;
  /** Extra headers, e.g. an idempotency key. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Normalised error surface so callers never import ClientError. */
export class GraphQLRequestError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly graphQLErrors: ReadonlyArray<{
    message: string;
    extensions?: Record<string, unknown>;
  }>;

  constructor(
    message: string,
    opts: {
      code?: string;
      status?: number;
      graphQLErrors?: ReadonlyArray<{ message: string; extensions?: Record<string, unknown> }>;
    } = {},
  ) {
    super(message);
    this.name = "GraphQLRequestError";
    this.code = opts.code;
    this.status = opts.status;
    this.graphQLErrors = opts.graphQLErrors ?? [];
  }

  get isUnauthenticated(): boolean {
    return (
      this.status === 401 || (this.code !== undefined && UNAUTHENTICATED_CODES.has(this.code))
    );
  }

  /** Backend is down / CORS / offline — distinct from "backend said no". */
  get isNetworkError(): boolean {
    return this.status === undefined && this.graphQLErrors.length === 0;
  }
}

function buildClient(options: GqlRequestOptions): GraphQLClient {
  const headers: Record<string, string> = { ...options.headers };
  if (!options.anonymous) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return new GraphQLClient(GRAPHQL_ENDPOINT, {
    headers,
    signal: options.signal,
    // Flip to "include" the day the backend sets an httpOnly refresh cookie.
    credentials: "same-origin",
  });
}

function toRequestError(error: unknown): GraphQLRequestError {
  if (error instanceof GraphQLRequestError) return error;

  if (error instanceof ClientError) {
    const errors = error.response.errors ?? [];
    const first = errors[0];
    const extensions = (first?.extensions ?? {}) as Record<string, unknown>;
    const code = typeof extensions.code === "string" ? extensions.code : undefined;
    return new GraphQLRequestError(first?.message ?? error.message, {
      code,
      status: error.response.status,
      graphQLErrors: errors.map((e) => ({
        message: e.message,
        extensions: e.extensions as Record<string, unknown> | undefined,
      })),
    });
  }

  // fetch() rejection: server unreachable. Must not white-screen the app.
  const message =
    error instanceof Error ? error.message : "Unable to reach the server. Is the API running?";
  return new GraphQLRequestError(message);
}

// ---------------------------------------------------------------------------
// Refresh de-duplication
// ---------------------------------------------------------------------------
let inFlightRefresh: Promise<boolean> | null = null;

/** Subscribers (AuthProvider) that need to know the session died. */
type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function endSession(): void {
  clearTokens();
  sessionExpiredListeners.forEach((l) => l());

  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return;
  const next = encodeURIComponent(`${pathname}${search}`);
  window.location.assign(`/login?next=${next}`);
}

/**
 * Returns true if a fresh access token is now in memory.
 * Concurrent callers all await the SAME promise — one network refresh, N waiters.
 */
async function refreshSession(): Promise<boolean> {
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async (): Promise<boolean> => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;

    try {
      const client = buildClient({ anonymous: true });
      const data = await client.request<RefreshResult>(REFRESH_MUTATION, { refreshToken });
      if (!data?.refreshToken?.accessToken) return false;
      setTokens({
        accessToken: data.refreshToken.accessToken,
        refreshToken: data.refreshToken.refreshToken ?? refreshToken,
      });
      return true;
    } catch {
      return false;
    }
  })();

  try {
    return await inFlightRefresh;
  } finally {
    inFlightRefresh = null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Execute a GraphQL document.
 *
 * @param document  A GraphQL query/mutation string.
 * @param variables Variables object (typed by the caller).
 * @param options   anonymous | skipAuthRefresh | headers | signal
 * @throws GraphQLRequestError — always this type, never a raw ClientError.
 */
export async function gqlRequest<TData, TVariables extends Variables = Variables>(
  document: string,
  variables?: TVariables,
  options: GqlRequestOptions = {},
): Promise<TData> {
  const run = async (): Promise<TData> => {
    const client = buildClient(options);
    return client.request<TData>(document, variables);
  };

  try {
    return await run();
  } catch (error) {
    const requestError = toRequestError(error);

    const canRetry =
      requestError.isUnauthenticated && !options.anonymous && !options.skipAuthRefresh;

    if (!canRetry) throw requestError;

    const refreshed = await refreshSession();
    if (!refreshed) {
      endSession();
      throw requestError;
    }

    // Exactly one retry. A second 401 means the new token is bad too — give up
    // rather than loop.
    try {
      return await run();
    } catch (retryError) {
      const finalError = toRequestError(retryError);
      if (finalError.isUnauthenticated) endSession();
      throw finalError;
    }
  }
}

/** Convenience wrapper for pre-auth calls (login, register, password reset). */
export function gqlPublicRequest<TData, TVariables extends Variables = Variables>(
  document: string,
  variables?: TVariables,
): Promise<TData> {
  return gqlRequest<TData, TVariables>(document, variables, {
    anonymous: true,
    skipAuthRefresh: true,
  });
}
