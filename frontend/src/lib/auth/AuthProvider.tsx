"use client";

/**
 * Auth context.
 *
 * SESSION RESTORE: the access token lives in memory, so it is gone after a
 * reload. On mount we check for a persisted refresh token; if there is one we run
 * `me` — the client's 401 interceptor silently refreshes and retries, which
 * doubles as the session restore. No refresh token => we skip the network call
 * entirely and settle as logged-out.
 *
 * FAILING GRACEFULLY IS A REQUIREMENT: the backend is built in parallel and may
 * simply not be running. A network error must land us in "logged out, here's the
 * login page" — never an unhandled rejection and never a white screen.
 */

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  GraphQLRequestError,
  gqlPublicRequest,
  gqlRequest,
  onSessionExpired,
} from "@/lib/graphql/client";
import { permissionsForRole } from "@/lib/auth/permissions";
import {
  LOGIN_MUTATION,
  LOGOUT_MUTATION,
  ME_QUERY,
  REGISTER_MUTATION,
} from "@/lib/auth/queries";
import {
  clearTokens,
  getRefreshToken,
  hasPersistedSession,
  setTokens,
} from "@/lib/auth/tokens";
import type { AuthPayload, Permission, User } from "@/types";

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  businessName: string;
}

export interface AuthContextValue {
  user: User | null;
  /** True while the initial session restore is in flight. Gate redirects on this. */
  isLoading: boolean;
  isAuthenticated: boolean;
  /** True when the API could not be reached at all (backend down / offline). */
  isOffline: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
  hasPermission: (permission: Permission) => boolean;
  hasAnyPermission: (permissions: readonly Permission[]) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);

  // StrictMode double-mounts effects in dev; without this the restore runs twice.
  const restoredRef = useRef(false);

  const fetchMe = useCallback(async (): Promise<User | null> => {
    try {
      const data = await gqlRequest<{ me: User | null }>(ME_QUERY);
      setIsOffline(false);
      return data.me ?? null;
    } catch (error) {
      if (error instanceof GraphQLRequestError && error.isNetworkError) {
        // Backend unreachable. Not a logout — just an unknown session.
        setIsOffline(true);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    let cancelled = false;

    void (async () => {
      if (!hasPersistedSession()) {
        if (!cancelled) setIsLoading(false);
        return;
      }
      const me = await fetchMe();
      if (cancelled) return;
      if (!me) clearTokens();
      setUser(me);
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchMe]);

  // The transport layer clears tokens and redirects on an unrecoverable 401; we
  // just need to drop the user so the UI stops rendering their name.
  useEffect(() => onSessionExpired(() => setUser(null)), []);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const data = await gqlPublicRequest<{ login: AuthPayload }>(LOGIN_MUTATION, {
      email,
      password,
    });
    setTokens({
      accessToken: data.login.accessToken,
      refreshToken: data.login.refreshToken,
    });
    setUser(data.login.user);
    setIsOffline(false);
    return data.login.user;
  }, []);

  const register = useCallback(async (input: RegisterInput): Promise<User> => {
    const data = await gqlPublicRequest<{ register: AuthPayload }>(REGISTER_MUTATION, input);
    setTokens({
      accessToken: data.register.accessToken,
      refreshToken: data.register.refreshToken,
    });
    setUser(data.register.user);
    setIsOffline(false);
    return data.register.user;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = getRefreshToken();
    try {
      // Best-effort server-side revocation. A failure here must not trap the user
      // in a session they asked to leave, so we clear locally regardless.
      await gqlRequest<{ logout: { success: boolean; message: string } }>(
        LOGOUT_MUTATION,
        { refreshToken },
        { skipAuthRefresh: true },
      );
    } catch {
      /* ignore */
    } finally {
      clearTokens();
      setUser(null);
      router.replace("/login");
    }
  }, [router]);

  const refreshUser = useCallback(async () => {
    const me = await fetchMe();
    if (me) setUser(me);
  }, [fetchMe]);

  /**
   * Prefer the server's permission list; fall back to the role matrix. Either way
   * this only decides what to *render* — the server authorises for real.
   */
  const permissions = useMemo<ReadonlySet<Permission>>(() => {
    if (!user) return new Set<Permission>();
    const list =
      user.permissions && user.permissions.length > 0
        ? user.permissions
        : permissionsForRole(user.role);
    return new Set(list);
  }, [user]);

  const hasPermission = useCallback(
    (permission: Permission) => permissions.has(permission),
    [permissions],
  );

  const hasAnyPermission = useCallback(
    (list: readonly Permission[]) => list.some((p) => permissions.has(p)),
    [permissions],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      isOffline,
      login,
      register,
      logout,
      hasPermission,
      hasAnyPermission,
      refreshUser,
    }),
    [
      user,
      isLoading,
      isOffline,
      login,
      register,
      logout,
      hasPermission,
      hasAnyPermission,
      refreshUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Convenience for conditional rendering: `usePermission("credit:delete")`. */
export function usePermission(permission: Permission): boolean {
  return useAuth().hasPermission(permission);
}
