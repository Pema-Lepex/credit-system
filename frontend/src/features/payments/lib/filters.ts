/**
 * Payment list state <-> URL query string. Same contract as the credit list: the
 * filters live in the URL so a view is shareable, bookmarkable and survives a
 * refresh, and every value is parsed defensively.
 */

import { PAYMENT_METHODS, type ID, type PaymentMethod } from "@/types";

import {
  PAYMENT_SORT_FIELDS,
  type PaymentFilterInput,
  type PaymentSortField,
  type PaymentsQueryVariables,
} from "@/features/payments/queries";

export const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface PaymentListState {
  search: string;
  method: PaymentMethod[];
  customerId: ID | null;
  creditId: ID | null;
  dateFrom: string | null;
  dateTo: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  /** Voided payments are hidden by default, but they are never deleted. */
  includeVoided: boolean;
  page: number;
  limit: number;
  sortField: PaymentSortField;
  sortDesc: boolean;
}

export const DEFAULT_PAYMENT_LIST_STATE: PaymentListState = {
  search: "",
  method: [],
  customerId: null,
  creditId: null,
  dateFrom: null,
  dateTo: null,
  minAmount: null,
  maxAmount: null,
  includeVoided: false,
  page: 1,
  limit: DEFAULT_PAGE_SIZE,
  sortField: "paid_at",
  sortDesc: true,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d+(\.\d{1,2})?$/;

function readInt(value: string | null, fallback: number, min: number, max: number): number {
  // `Number(null)` is 0, NOT NaN, and 0 IS an integer — so checking only
  // `Number.isInteger` would accept a missing param and clamp it to `min`, turning
  // an absent `?limit` into one row per page. Handle the empty case first.
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function isMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

function isSortField(value: string): value is PaymentSortField {
  return (PAYMENT_SORT_FIELDS as readonly string[]).includes(value);
}

export function parsePaymentListState(params: URLSearchParams): PaymentListState {
  const methodParam = params.get("method");
  const sortParam = params.get("sort");
  const dateFrom = params.get("from");
  const dateTo = params.get("to");
  const min = params.get("min");
  const max = params.get("max");

  return {
    search: params.get("q") ?? "",
    method: methodParam ? methodParam.split(",").filter(isMethod) : [],
    customerId: params.get("customer") || null,
    creditId: params.get("credit") || null,
    dateFrom: dateFrom && ISO_DATE.test(dateFrom) ? dateFrom : null,
    dateTo: dateTo && ISO_DATE.test(dateTo) ? dateTo : null,
    minAmount: min && DECIMAL.test(min) ? min : null,
    maxAmount: max && DECIMAL.test(max) ? max : null,
    includeVoided: params.get("voided") === "1",
    page: readInt(params.get("page"), 1, 1, 100_000),
    limit: readInt(params.get("limit"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
    sortField:
      sortParam && isSortField(sortParam) ? sortParam : DEFAULT_PAYMENT_LIST_STATE.sortField,
    sortDesc: params.get("dir") !== "asc",
  };
}

export function serialisePaymentListState(state: PaymentListState): string {
  const params = new URLSearchParams();

  if (state.search) params.set("q", state.search);
  if (state.method.length > 0) params.set("method", state.method.join(","));
  if (state.customerId) params.set("customer", state.customerId);
  if (state.creditId) params.set("credit", state.creditId);
  if (state.dateFrom) params.set("from", state.dateFrom);
  if (state.dateTo) params.set("to", state.dateTo);
  if (state.minAmount) params.set("min", state.minAmount);
  if (state.maxAmount) params.set("max", state.maxAmount);
  if (state.includeVoided) params.set("voided", "1");
  if (state.page !== 1) params.set("page", String(state.page));
  if (state.limit !== DEFAULT_PAGE_SIZE) params.set("limit", String(state.limit));
  if (state.sortField !== DEFAULT_PAYMENT_LIST_STATE.sortField) params.set("sort", state.sortField);
  if (!state.sortDesc) params.set("dir", "asc");

  return params.toString();
}

export function toPaymentsQueryVariables(state: PaymentListState): PaymentsQueryVariables {
  const filter: PaymentFilterInput = {
    search: state.search.trim() || null,
    method: state.method.length > 0 ? state.method : null,
    customerId: state.customerId,
    creditId: state.creditId,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    minAmount: state.minAmount,
    maxAmount: state.maxAmount,
    includeVoided: state.includeVoided,
  };

  return {
    filter,
    page: { page: state.page, limit: state.limit },
    sort: { field: state.sortField, desc: state.sortDesc },
  };
}

export function countActivePaymentFilters(state: PaymentListState): number {
  let count = 0;
  if (state.search.trim()) count += 1;
  if (state.method.length > 0) count += 1;
  if (state.customerId) count += 1;
  if (state.creditId) count += 1;
  if (state.dateFrom || state.dateTo) count += 1;
  if (state.minAmount || state.maxAmount) count += 1;
  if (state.includeVoided) count += 1;
  return count;
}
