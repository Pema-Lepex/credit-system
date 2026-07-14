"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import {
  DEFAULT_CREDIT_LIST_STATE,
  parseCreditListState,
  serialiseCreditListState,
  toCreditsQueryVariables,
  type CreditListState,
} from "@/features/credits/lib/filters";
import {
  creditKeys,
  CREDITS_QUERY,
  type CreditsQueryResult,
  type CreditsQueryVariables,
} from "@/features/credits/queries";
import { gqlRequest } from "@/lib/graphql/client";

export interface CreditListStateController {
  state: CreditListState;
  /**
   * Merge a patch into the URL. Any change other than paging resets to page 1 —
   * being on page 7 of a list you just re-filtered is a guaranteed empty screen.
   */
  update: (patch: Partial<CreditListState>) => void;
  reset: () => void;
}

export function useCreditListState(): CreditListStateController {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo(
    () => parseCreditListState(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const update = useCallback(
    (patch: Partial<CreditListState>) => {
      const isPaging = "page" in patch || "limit" in patch;
      const next: CreditListState = { ...state, ...patch };
      if (!isPaging) next.page = 1;

      const query = serialiseCreditListState(next);
      // replace, not push: a filter tweak is not a navigation, and pushing would
      // make Back walk through every keystroke of a search box.
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, state],
  );

  const reset = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  return { state, update, reset };
}

export function useCredits(variables: CreditsQueryVariables) {
  return useQuery({
    queryKey: creditKeys.list(variables),
    queryFn: () =>
      gqlRequest<CreditsQueryResult, Record<string, unknown>>(CREDITS_QUERY, {
        filter: variables.filter,
        page: variables.page,
        sort: variables.sort,
      }),
    // Hold the previous page while the next one loads. A skeleton flash on every
    // page click is a layout jump, and the table is the thing the user is reading.
    placeholderData: keepPreviousData,
    select: (data) => data.credits,
  });
}

/** Convenience: the list state and its query, wired together. */
export function useCreditList() {
  const controller = useCreditListState();
  const variables = useMemo(
    () => toCreditsQueryVariables(controller.state),
    [controller.state],
  );
  const query = useCredits(variables);
  return { ...controller, query, variables, defaults: DEFAULT_CREDIT_LIST_STATE };
}
