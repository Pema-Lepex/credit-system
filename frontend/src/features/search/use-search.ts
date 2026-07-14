"use client";

import { useQuery } from "@tanstack/react-query";

import { useDebouncedValue } from "@/features/common/use-debounced-value";
import { gqlRequest } from "@/lib/graphql/client";

import { SEARCH_QUERY, type SearchResult, type SearchResults } from "./api";

export const searchKeys = {
  query: (term: string, limit: number) => ["search", term, limit] as const,
};

export interface UseSearchResult {
  data: SearchResults | undefined;
  /** True while a *new* term is in flight — not while the debounce is pending. */
  isFetching: boolean;
  /** True from the first keystroke until results for that term land. */
  isPending: boolean;
  error: unknown;
  /** The term the current results actually belong to. */
  term: string;
}

/**
 * Debounced global search.
 *
 * 250ms: one request per burst of typing, not one per keystroke. Terms shorter
 * than two characters are not sent at all — "a" matches half the database and
 * the answer is useless.
 *
 * `isPending` deliberately covers the debounce window too: without it the palette
 * shows "No results for 'dor'" for 250ms before the request even leaves, which
 * reads as a wrong answer rather than a pending one.
 */
export function useSearch(query: string, limit = 20): UseSearchResult {
  const term = query.trim();
  const debounced = useDebouncedValue(term, 250);
  const enabled = debounced.length >= 2;

  const { data, isFetching, error } = useQuery({
    queryKey: searchKeys.query(debounced, limit),
    queryFn: () =>
      gqlRequest<SearchResult>(SEARCH_QUERY, { query: debounced, limit }).then((d) => d.search),
    enabled,
    staleTime: 30_000,
  });

  return {
    data: enabled ? data : undefined,
    isFetching,
    isPending: term.length >= 2 && (debounced !== term || (isFetching && !data)),
    error,
    term: debounced,
  };
}
