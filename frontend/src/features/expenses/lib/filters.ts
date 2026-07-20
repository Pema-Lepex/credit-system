/**
 * Expense list state <-> URL query string. Same contract as the payment list: the
 * filters live in the URL so a view is shareable, bookmarkable and survives a
 * refresh, and every value is parsed defensively.
 */

import { PAYMENT_METHODS, type ID, type PaymentMethod } from "@/types";

import {
  EXPENSE_SORT_FIELDS,
  type ExpenseFilterInput,
  type ExpenseSortField,
  type ExpensesQueryVariables,
} from "@/features/expenses/queries";

export const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface ExpenseListState {
  search: string;
  categoryId: ID | null;
  vendorName: string;
  paymentMethod: PaymentMethod[];
  dateFrom: string | null;
  dateTo: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  page: number;
  limit: number;
  sortField: ExpenseSortField;
  sortDesc: boolean;
}

export const DEFAULT_EXPENSE_LIST_STATE: ExpenseListState = {
  search: "",
  categoryId: null,
  vendorName: "",
  paymentMethod: [],
  dateFrom: null,
  dateTo: null,
  minAmount: null,
  maxAmount: null,
  page: 1,
  limit: DEFAULT_PAGE_SIZE,
  sortField: "expense_date",
  sortDesc: true,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d+(\.\d{1,2})?$/;

function readInt(value: string | null, fallback: number, min: number, max: number): number {
  // See the payment filters for why the empty case is handled before Number():
  // `Number(null)` is 0, not NaN, so an absent `?limit` would clamp to one row.
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function isMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

function isSortField(value: string): value is ExpenseSortField {
  return (EXPENSE_SORT_FIELDS as readonly string[]).includes(value);
}

export function parseExpenseListState(params: URLSearchParams): ExpenseListState {
  const methodParam = params.get("method");
  const sortParam = params.get("sort");
  const dateFrom = params.get("from");
  const dateTo = params.get("to");
  const min = params.get("min");
  const max = params.get("max");

  return {
    search: params.get("q") ?? "",
    categoryId: params.get("category") || null,
    vendorName: params.get("vendor") ?? "",
    paymentMethod: methodParam ? methodParam.split(",").filter(isMethod) : [],
    dateFrom: dateFrom && ISO_DATE.test(dateFrom) ? dateFrom : null,
    dateTo: dateTo && ISO_DATE.test(dateTo) ? dateTo : null,
    minAmount: min && DECIMAL.test(min) ? min : null,
    maxAmount: max && DECIMAL.test(max) ? max : null,
    page: readInt(params.get("page"), 1, 1, 100_000),
    limit: readInt(params.get("limit"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
    sortField:
      sortParam && isSortField(sortParam) ? sortParam : DEFAULT_EXPENSE_LIST_STATE.sortField,
    sortDesc: params.get("dir") !== "asc",
  };
}

export function serialiseExpenseListState(state: ExpenseListState): string {
  const params = new URLSearchParams();

  if (state.search) params.set("q", state.search);
  if (state.categoryId) params.set("category", state.categoryId);
  if (state.vendorName) params.set("vendor", state.vendorName);
  if (state.paymentMethod.length > 0) params.set("method", state.paymentMethod.join(","));
  if (state.dateFrom) params.set("from", state.dateFrom);
  if (state.dateTo) params.set("to", state.dateTo);
  if (state.minAmount) params.set("min", state.minAmount);
  if (state.maxAmount) params.set("max", state.maxAmount);
  if (state.page !== 1) params.set("page", String(state.page));
  if (state.limit !== DEFAULT_PAGE_SIZE) params.set("limit", String(state.limit));
  if (state.sortField !== DEFAULT_EXPENSE_LIST_STATE.sortField) params.set("sort", state.sortField);
  if (!state.sortDesc) params.set("dir", "asc");

  return params.toString();
}

export function toExpensesQueryVariables(state: ExpenseListState): ExpensesQueryVariables {
  const filter: ExpenseFilterInput = {
    search: state.search.trim() || null,
    categoryId: state.categoryId,
    vendorName: state.vendorName.trim() || null,
    paymentMethod: state.paymentMethod.length > 0 ? state.paymentMethod : null,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    minAmount: state.minAmount,
    maxAmount: state.maxAmount,
  };

  return {
    filter,
    page: { page: state.page, limit: state.limit },
    sort: { field: state.sortField, desc: state.sortDesc },
  };
}

export function countActiveExpenseFilters(state: ExpenseListState): number {
  let count = 0;
  if (state.search.trim()) count += 1;
  if (state.categoryId) count += 1;
  if (state.vendorName.trim()) count += 1;
  if (state.paymentMethod.length > 0) count += 1;
  if (state.dateFrom || state.dateTo) count += 1;
  if (state.minAmount || state.maxAmount) count += 1;
  return count;
}
