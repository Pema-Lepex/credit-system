"use client";

/**
 * The customers table's entire view state, derived from the URL.
 *
 * Everything the user can change — search, status, outstanding range, the overdue
 * toggle, page, page size, sort — is a query-string parameter, so the view is
 * shareable and survives a refresh. The GraphQL variables are derived from the
 * URL, never stored alongside it.
 */

import { useCallback, useMemo } from "react";

import { useQueryState } from "@/features/common/use-query-state";
import { CUSTOMER_STATUSES, type CustomerStatus } from "@/types";

import type { CustomerFilterInput, PageInput, SortInput } from "./api";

/** Server whitelist — customer.py SORT_FIELDS. Anything else is a 422. */
export const CUSTOMER_SORT_FIELDS = [
  "name",
  "code",
  "created_at",
  "outstanding_balance",
  "credit_score",
] as const;
export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

export const CUSTOMER_FILTER_KEYS = [
  "q",
  "status",
  "min",
  "max",
  "overdue",
  "page",
  "limit",
  "sort",
  "desc",
] as const;

const DEFAULT_SORT: CustomerSortField = "created_at";

function isSortField(value: string): value is CustomerSortField {
  return (CUSTOMER_SORT_FIELDS as readonly string[]).includes(value);
}

function isStatus(value: string): value is CustomerStatus {
  return (CUSTOMER_STATUSES as readonly string[]).includes(value);
}

export interface CustomerFiltersState {
  search: string;
  statuses: CustomerStatus[];
  minOutstanding: string;
  maxOutstanding: string;
  hasOverdue: boolean;
  page: number;
  limit: number;
  sortField: CustomerSortField;
  sortDesc: boolean;
  /** True when anything other than paging/sorting is set. */
  isFiltered: boolean;

  setSearch: (value: string) => void;
  toggleStatus: (status: CustomerStatus) => void;
  setOutstanding: (min: string, max: string) => void;
  setHasOverdue: (value: boolean) => void;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  setSort: (field: CustomerSortField, desc: boolean) => void;
  clear: () => void;

  /** Exactly what the `customers` query wants. */
  variables: { filter: CustomerFilterInput; page: PageInput; sort: SortInput };
}

export function useCustomerFilters(): CustomerFiltersState {
  const { get, getList, getNumber, getBoolean, set, reset } = useQueryState();

  const search = get("q");
  const statuses = getList("status").filter(isStatus);
  const minOutstanding = get("min");
  const maxOutstanding = get("max");
  const hasOverdue = getBoolean("overdue") ?? false;
  const page = Math.max(1, getNumber("page", 1));
  const limit = getNumber("limit", 25);

  const rawSort = get("sort", DEFAULT_SORT);
  const sortField: CustomerSortField = isSortField(rawSort) ? rawSort : DEFAULT_SORT;
  const sortDesc = getBoolean("desc") ?? true;

  // Any filter change resets to page 1 — staying on page 7 of a result set that
  // now has two pages shows an empty table and looks broken.
  const setSearch = useCallback((value: string) => set({ q: value, page: null }), [set]);

  const toggleStatus = useCallback(
    (status: CustomerStatus) => {
      const next = statuses.includes(status)
        ? statuses.filter((s) => s !== status)
        : [...statuses, status];
      set({ status: next, page: null });
    },
    [set, statuses],
  );

  const setOutstanding = useCallback(
    (min: string, max: string) => set({ min, max, page: null }),
    [set],
  );

  const setHasOverdue = useCallback(
    (value: boolean) => set({ overdue: value ? "1" : null, page: null }),
    [set],
  );

  const setPage = useCallback((next: number) => set({ page: next <= 1 ? null : next }), [set]);
  const setLimit = useCallback(
    (next: number) => set({ limit: next === 25 ? null : next, page: null }),
    [set],
  );
  const setSort = useCallback(
    (field: CustomerSortField, desc: boolean) => set({ sort: field, desc: desc ? "1" : "0" }),
    [set],
  );
  const clear = useCallback(() => reset(CUSTOMER_FILTER_KEYS), [reset]);

  const variables = useMemo(
    () => ({
      filter: {
        search: search || null,
        status: statuses.length > 0 ? statuses : null,
        // Money stays a string all the way to the server. Number() here would be
        // the one float that ruins a Decimal comparison.
        minOutstanding: minOutstanding || null,
        maxOutstanding: maxOutstanding || null,
        hasOverdue: hasOverdue ? true : null,
      },
      page: { page, limit },
      sort: { field: sortField, desc: sortDesc },
    }),
    // statuses is a fresh array each render; its contents are the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, statuses.join(","), minOutstanding, maxOutstanding, hasOverdue, page, limit, sortField, sortDesc],
  );

  return {
    search,
    statuses,
    minOutstanding,
    maxOutstanding,
    hasOverdue,
    page,
    limit,
    sortField,
    sortDesc,
    isFiltered: Boolean(
      search || statuses.length > 0 || minOutstanding || maxOutstanding || hasOverdue,
    ),
    setSearch,
    toggleStatus,
    setOutstanding,
    setHasOverdue,
    setPage,
    setLimit,
    setSort,
    clear,
    variables,
  };
}
