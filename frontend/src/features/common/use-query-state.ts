"use client";

/**
 * Table state that lives in the URL.
 *
 * A filtered table whose state is component-local is un-shareable and dies on
 * refresh: the shopkeeper filters to "blocked customers who owe > 5,000", sends
 * the link to their partner, and the partner sees an unfiltered list. So every
 * filter, the page, the page size and the sort go in the query string, and the
 * URL is the single source of truth — there is no second copy of this state to
 * drift out of sync.
 *
 * `router.replace` (not push) so paging does not stuff the back button with
 * twenty entries; `scroll: false` so changing a filter does not jump the page.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export type QueryPatch = Record<string, string | number | boolean | string[] | null | undefined>;

export interface QueryState {
  params: URLSearchParams;
  /** Read a single value. */
  get: (key: string, fallback?: string) => string;
  getNumber: (key: string, fallback: number) => number;
  getBoolean: (key: string) => boolean | undefined;
  /** Read a repeated/CSV value as a list. */
  getList: (key: string) => string[];
  /** Merge a patch into the URL. `null`/`undefined`/"" removes the key. */
  set: (patch: QueryPatch) => void;
  /** Drop every key this table owns. */
  reset: (keys?: readonly string[]) => void;
}

export function useQueryState(): QueryState {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // A stable string is the right dependency: URLSearchParams identity changes on
  // every render, which would re-create `set` (and every callback below it).
  const serialized = searchParams.toString();

  const params = useMemo(() => new URLSearchParams(serialized), [serialized]);

  const commit = useCallback(
    (next: URLSearchParams) => {
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const set = useCallback(
    (patch: QueryPatch) => {
      const next = new URLSearchParams(serialized);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === "") {
          next.delete(key);
        } else if (Array.isArray(value)) {
          if (value.length === 0) next.delete(key);
          else next.set(key, value.join(","));
        } else {
          next.set(key, String(value));
        }
      }
      commit(next);
    },
    [commit, serialized],
  );

  const reset = useCallback(
    (keys?: readonly string[]) => {
      if (!keys) {
        commit(new URLSearchParams());
        return;
      }
      const next = new URLSearchParams(serialized);
      keys.forEach((key) => next.delete(key));
      commit(next);
    },
    [commit, serialized],
  );

  return useMemo<QueryState>(
    () => ({
      params,
      set,
      reset,
      get: (key, fallback = "") => params.get(key) ?? fallback,
      getNumber: (key, fallback) => {
        const raw = params.get(key);
        if (raw === null) return fallback;
        const n = Number(raw);
        return Number.isFinite(n) ? n : fallback;
      },
      getBoolean: (key) => {
        const raw = params.get(key);
        if (raw === null) return undefined;
        return raw === "1" || raw === "true";
      },
      getList: (key) => {
        const raw = params.get(key);
        if (!raw) return [];
        return raw.split(",").filter(Boolean);
      },
    }),
    [params, set, reset],
  );
}
