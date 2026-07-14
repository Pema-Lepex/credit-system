/**
 * Credit list state <-> URL query string.
 *
 * The filters live in the URL, not in React state, for three reasons: a filtered
 * view is shareable ("look at Dorji's overdue credits" is a link), it survives a
 * refresh, and Back does what the user means. React state would lose all three.
 *
 * Everything is parsed defensively — a hand-edited `?status=BANANA&page=-4` must
 * degrade to a sane list, never a crash or an unbounded query.
 */

import { CREDIT_STATUSES, type CreditStatus, type ID } from "@/types";

import {
  CREDIT_SORT_FIELDS,
  type CreditFilterInput,
  type CreditSortField,
  type CreditsQueryVariables,
} from "@/features/credits/queries";

export const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100; // matches the backend's own clamp
const PAGE_SIZES = [10, 25, 50, 100] as const;

export interface CreditListState {
  search: string;
  status: CreditStatus[];
  customerId: ID | null;
  dueFrom: string | null;
  dueTo: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  overdueOnly: boolean;
  page: number;
  limit: number;
  sortField: CreditSortField;
  sortDesc: boolean;
}

export const DEFAULT_CREDIT_LIST_STATE: CreditListState = {
  search: "",
  status: [],
  customerId: null,
  dueFrom: null,
  dueTo: null,
  minAmount: null,
  maxAmount: null,
  overdueOnly: false,
  page: 1,
  limit: DEFAULT_PAGE_SIZE,
  sortField: "due_date",
  sortDesc: false,
};

export { PAGE_SIZES };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d+(\.\d{1,2})?$/;

function readInt(value: string | null, fallback: number, min: number, max: number): number {
  // `Number(null)` is 0, NOT NaN — and 0 is an integer, so a naive
  // `Number.isInteger` check would silently accept a MISSING param and clamp it to
  // `min`. That is how `?limit` absent became "1 row per page". Bail out on the
  // empty case first, and only then parse.
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function readDate(value: string | null): string | null {
  return value && ISO_DATE.test(value) ? value : null;
}

function readMoney(value: string | null): string | null {
  return value && DECIMAL.test(value) ? value : null;
}

function isCreditStatus(value: string): value is CreditStatus {
  return (CREDIT_STATUSES as readonly string[]).includes(value);
}

function isSortField(value: string): value is CreditSortField {
  return (CREDIT_SORT_FIELDS as readonly string[]).includes(value);
}

/** URLSearchParams -> state. Never throws. */
export function parseCreditListState(params: URLSearchParams): CreditListState {
  const statusParam = params.get("status");
  const sortParam = params.get("sort");

  return {
    search: params.get("q") ?? "",
    status: statusParam ? statusParam.split(",").filter(isCreditStatus) : [],
    customerId: params.get("customer") || null,
    dueFrom: readDate(params.get("dueFrom")),
    dueTo: readDate(params.get("dueTo")),
    minAmount: readMoney(params.get("min")),
    maxAmount: readMoney(params.get("max")),
    overdueOnly: params.get("overdue") === "1",
    page: readInt(params.get("page"), 1, 1, 100_000),
    limit: readInt(params.get("limit"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
    sortField:
      sortParam && isSortField(sortParam) ? sortParam : DEFAULT_CREDIT_LIST_STATE.sortField,
    sortDesc: params.get("dir") === "desc",
  };
}

/**
 * State -> query string. Defaults are OMITTED, so a pristine list is `/credits`
 * and not `/credits?q=&status=&page=1&limit=25&...`. A URL that only carries the
 * non-default bits is one a human can read and edit.
 */
export function serialiseCreditListState(state: CreditListState): string {
  const params = new URLSearchParams();

  if (state.search) params.set("q", state.search);
  if (state.status.length > 0) params.set("status", state.status.join(","));
  if (state.customerId) params.set("customer", state.customerId);
  if (state.dueFrom) params.set("dueFrom", state.dueFrom);
  if (state.dueTo) params.set("dueTo", state.dueTo);
  if (state.minAmount) params.set("min", state.minAmount);
  if (state.maxAmount) params.set("max", state.maxAmount);
  if (state.overdueOnly) params.set("overdue", "1");
  if (state.page !== 1) params.set("page", String(state.page));
  if (state.limit !== DEFAULT_PAGE_SIZE) params.set("limit", String(state.limit));
  if (state.sortField !== DEFAULT_CREDIT_LIST_STATE.sortField) params.set("sort", state.sortField);
  if (state.sortDesc !== DEFAULT_CREDIT_LIST_STATE.sortDesc) {
    params.set("dir", state.sortDesc ? "desc" : "asc");
  }

  return params.toString();
}

/** State -> the exact variables the `credits` query takes. */
export function toCreditsQueryVariables(state: CreditListState): CreditsQueryVariables {
  const filter: CreditFilterInput = {
    search: state.search.trim() || null,
    status: state.status.length > 0 ? state.status : null,
    customerId: state.customerId,
    dueFrom: state.dueFrom,
    dueTo: state.dueTo,
    minAmount: state.minAmount,
    maxAmount: state.maxAmount,
    overdueOnly: state.overdueOnly,
  };

  return {
    filter,
    page: { page: state.page, limit: state.limit },
    sort: { field: state.sortField, desc: state.sortDesc },
  };
}

/** Drives the "Clear filters" affordance — and the empty state's copy. */
export function countActiveCreditFilters(state: CreditListState): number {
  let count = 0;
  if (state.search.trim()) count += 1;
  if (state.status.length > 0) count += 1;
  if (state.customerId) count += 1;
  if (state.dueFrom || state.dueTo) count += 1;
  if (state.minAmount || state.maxAmount) count += 1;
  if (state.overdueOnly) count += 1;
  return count;
}
