"use client";

/**
 * URL-backed view state for the product and service tables.
 *
 * Same contract as the customers table: the query string is the only copy of the
 * state, so /products?low=1&cat=…&view=grid is a link a shopkeeper can bookmark
 * as "things I need to reorder".
 */

import { useCallback, useMemo } from "react";

import { useQueryState } from "@/features/common/use-query-state";
import type { ID } from "@/types";

import type { PageInput, ProductFilterInput, ServiceFilterInput, SortInput } from "./api";

/** catalog.py PRODUCT_SORT_FIELDS / SERVICE_SORT_FIELDS. */
export const PRODUCT_SORT_FIELDS = ["name", "created_at", "price", "stock_quantity"] as const;
export const SERVICE_SORT_FIELDS = ["name", "created_at", "price"] as const;

export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];
export type ServiceSortField = (typeof SERVICE_SORT_FIELDS)[number];

export type ProductView = "table" | "grid";

const KEYS = ["q", "cat", "active", "low", "page", "limit", "sort", "desc"] as const;

interface BaseCatalogFilters {
  search: string;
  categoryId: ID | null;
  isActive: boolean | null;
  page: number;
  limit: number;
  sortDesc: boolean;
  isFiltered: boolean;

  setSearch: (value: string) => void;
  setCategory: (id: ID | null) => void;
  setActive: (value: boolean | null) => void;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  clear: () => void;
}

export interface ProductFiltersState extends BaseCatalogFilters {
  lowStockOnly: boolean;
  sortField: ProductSortField;
  view: ProductView;
  setLowStockOnly: (value: boolean) => void;
  setSort: (field: ProductSortField, desc: boolean) => void;
  setView: (view: ProductView) => void;
  variables: { filter: ProductFilterInput; page: PageInput; sort: SortInput };
}

export interface ServiceFiltersState extends BaseCatalogFilters {
  sortField: ServiceSortField;
  setSort: (field: ServiceSortField, desc: boolean) => void;
  variables: { filter: ServiceFilterInput; page: PageInput; sort: SortInput };
}

function useBase() {
  const { get, getNumber, getBoolean, set, reset } = useQueryState();

  const search = get("q");
  const categoryId = get("cat") || null;
  const isActive = getBoolean("active") ?? null;
  const page = Math.max(1, getNumber("page", 1));
  const limit = getNumber("limit", 25);
  const sortDesc = getBoolean("desc") ?? false;

  const setSearch = useCallback((value: string) => set({ q: value, page: null }), [set]);
  const setCategory = useCallback((id: ID | null) => set({ cat: id, page: null }), [set]);
  const setActive = useCallback(
    (value: boolean | null) =>
      set({ active: value === null ? null : value ? "1" : "0", page: null }),
    [set],
  );
  const setPage = useCallback((next: number) => set({ page: next <= 1 ? null : next }), [set]);
  const setLimit = useCallback(
    (next: number) => set({ limit: next === 25 ? null : next, page: null }),
    [set],
  );
  const clear = useCallback(() => reset(KEYS), [reset]);

  const shared = useMemo(
    () => ({
      search,
      categoryId,
      isActive,
      page,
      limit,
      sortDesc,
      setSearch,
      setCategory,
      setActive,
      setPage,
      setLimit,
      clear,
    }),
    [
      search,
      categoryId,
      isActive,
      page,
      limit,
      sortDesc,
      setSearch,
      setCategory,
      setActive,
      setPage,
      setLimit,
      clear,
    ],
  );

  return { get, set, shared };
}

export function useProductFilters(): ProductFiltersState {
  const { get, set, shared } = useBase();

  const lowStockOnly = get("low") === "1";
  const rawSort = get("sort", "name");
  const sortField: ProductSortField = (PRODUCT_SORT_FIELDS as readonly string[]).includes(rawSort)
    ? (rawSort as ProductSortField)
    : "name";
  const view: ProductView = get("view") === "grid" ? "grid" : "table";

  const setLowStockOnly = useCallback(
    (value: boolean) => set({ low: value ? "1" : null, page: null }),
    [set],
  );
  const setSort = useCallback(
    (field: ProductSortField, desc: boolean) => set({ sort: field, desc: desc ? "1" : "0" }),
    [set],
  );
  const setView = useCallback(
    (next: ProductView) => set({ view: next === "table" ? null : next }),
    [set],
  );

  const { search, categoryId, isActive, page, limit, sortDesc } = shared;

  const variables = useMemo(
    () => ({
      filter: {
        search: search || null,
        categoryId,
        isActive,
        // Non-null in the schema (`Boolean! = false`) — send the boolean, not null.
        lowStockOnly,
      },
      page: { page, limit },
      sort: { field: sortField, desc: sortDesc },
    }),
    [search, categoryId, isActive, lowStockOnly, page, limit, sortField, sortDesc],
  );

  return {
    ...shared,
    lowStockOnly,
    sortField,
    view,
    isFiltered: Boolean(search || categoryId || isActive !== null || lowStockOnly),
    setLowStockOnly,
    setSort,
    setView,
    variables,
  };
}

export function useServiceFilters(): ServiceFiltersState {
  const { get, set, shared } = useBase();

  const rawSort = get("sort", "name");
  const sortField: ServiceSortField = (SERVICE_SORT_FIELDS as readonly string[]).includes(rawSort)
    ? (rawSort as ServiceSortField)
    : "name";

  const setSort = useCallback(
    (field: ServiceSortField, desc: boolean) => set({ sort: field, desc: desc ? "1" : "0" }),
    [set],
  );

  const { search, categoryId, isActive, page, limit, sortDesc } = shared;

  const variables = useMemo(
    () => ({
      filter: { search: search || null, categoryId, isActive },
      page: { page, limit },
      sort: { field: sortField, desc: sortDesc },
    }),
    [search, categoryId, isActive, page, limit, sortField, sortDesc],
  );

  return {
    ...shared,
    sortField,
    isFiltered: Boolean(search || categoryId || isActive !== null),
    setSort,
    variables,
  };
}
