"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { toast } from "@/components/ui";
import { parseApiError } from "@/features/credits/lib/errors";
import { dashboardKeys } from "@/features/dashboard/queries";
import {
  DEFAULT_EXPENSE_LIST_STATE,
  parseExpenseListState,
  serialiseExpenseListState,
  toExpensesQueryVariables,
  type ExpenseListState,
} from "@/features/expenses/lib/filters";
import {
  CREATE_EXPENSE_CATEGORY_MUTATION,
  CREATE_EXPENSE_MUTATION,
  DELETE_EXPENSE_MUTATION,
  EXPENSES_QUERY,
  EXPENSE_CATEGORIES_QUERY,
  EXPENSE_QUERY,
  UPDATE_EXPENSE_MUTATION,
  expenseKeys,
  type ExpenseCategoriesQueryResult,
  type ExpenseCategoryRow,
  type ExpenseInput,
  type ExpenseRow,
  type ExpensesQueryResult,
  type ExpensesQueryVariables,
} from "@/features/expenses/queries";
import { gqlRequest } from "@/lib/graphql/client";
import type { ID } from "@/types";

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
export interface ExpenseListStateController {
  state: ExpenseListState;
  update: (patch: Partial<ExpenseListState>) => void;
  reset: () => void;
}

export function useExpenseListState(): ExpenseListStateController {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo(
    () => parseExpenseListState(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const update = useCallback(
    (patch: Partial<ExpenseListState>) => {
      const isPaging = "page" in patch || "limit" in patch;
      const next: ExpenseListState = { ...state, ...patch };
      // Any non-paging change invalidates the current page number: filtering to 3
      // results while on page 7 would otherwise show an empty table.
      if (!isPaging) next.page = 1;

      const query = serialiseExpenseListState(next);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, state],
  );

  const reset = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  return { state, update, reset };
}

export function useExpenses(variables: ExpensesQueryVariables) {
  return useQuery({
    queryKey: expenseKeys.list(variables),
    queryFn: () =>
      gqlRequest<ExpensesQueryResult, Record<string, unknown>>(EXPENSES_QUERY, {
        filter: variables.filter,
        page: variables.page,
        sort: variables.sort,
      }),
    placeholderData: keepPreviousData,
    select: (data) => data.expenses,
  });
}

export function useExpenseList() {
  const controller = useExpenseListState();
  const variables = useMemo(() => toExpensesQueryVariables(controller.state), [controller.state]);
  const query = useExpenses(variables);
  return { ...controller, query, variables, defaults: DEFAULT_EXPENSE_LIST_STATE };
}

export function useExpense(id: ID | null) {
  return useQuery({
    queryKey: expenseKeys.detail(id ?? ("" as ID)),
    queryFn: () =>
      gqlRequest<{ expense: ExpenseRow }, { id: ID }>(EXPENSE_QUERY, { id: id as ID }).then(
        (data) => data.expense,
      ),
    enabled: Boolean(id),
  });
}

/**
 * The category picker. Only ACTIVE categories are offered for new expenses —
 * a deactivated bucket keeps its history but stops appearing in the form.
 */
export function useExpenseCategories(options?: { includeInactive?: boolean }) {
  const includeInactive = options?.includeInactive ?? false;

  return useQuery({
    queryKey: [...expenseKeys.categories(), { includeInactive }],
    queryFn: () =>
      gqlRequest<ExpenseCategoriesQueryResult, { isActive: boolean | null }>(
        EXPENSE_CATEGORIES_QUERY,
        { isActive: includeInactive ? null : true },
      ).then((data) => data.expenseCategories),
    staleTime: 60_000, // categories change rarely; the form opens often
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
/**
 * An expense moves money OUT, so it moves every figure derived from money out:
 * the expense list itself, the dashboard cards, and both accounting reports.
 * It deliberately does NOT touch customer or credit caches — an expense never
 * moves a customer balance (see backend/app/models/expense.py).
 */
function useInvalidateExpenseWrites() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: expenseKeys.all });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
  };
}

export function useCreateExpense() {
  const invalidate = useInvalidateExpenseWrites();

  return useMutation({
    mutationFn: (input: ExpenseInput) =>
      gqlRequest<{ createExpense: ExpenseRow }, { input: ExpenseInput }>(CREATE_EXPENSE_MUTATION, {
        input,
      }).then((data) => data.createExpense),
    onSuccess: () => {
      invalidate();
      toast.success("Expense recorded");
    },
    // Errors are NOT toasted: validation failures (amount <= 0, future date) come
    // back with a `field`, and the form puts them where the user is already looking.
  });
}

export function useUpdateExpense() {
  const invalidate = useInvalidateExpenseWrites();

  return useMutation({
    mutationFn: ({ id, input }: { id: ID; input: ExpenseInput }) =>
      gqlRequest<{ updateExpense: ExpenseRow }, { id: ID; input: ExpenseInput }>(
        UPDATE_EXPENSE_MUTATION,
        { id, input },
      ).then((data) => data.updateExpense),
    onSuccess: () => {
      invalidate();
      toast.success("Expense updated");
    },
  });
}

/** Soft-delete to the Trash. Admin-only on the server (EXPENSE_DELETE). */
export function useDeleteExpense() {
  const invalidate = useInvalidateExpenseWrites();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: ID) =>
      gqlRequest<{ deleteExpense: Pick<ExpenseRow, "id" | "amount"> }, { id: ID }>(
        DELETE_EXPENSE_MUTATION,
        { id },
      ).then((data) => data.deleteExpense),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["trash"] });
      toast.success("Expense moved to Trash", {
        description: "Nothing else changed. You can restore it at any time.",
      });
    },
    onError: (error) => {
      toast.error("Could not delete the expense", {
        description: parseApiError(error).message,
      });
    },
  });
}

export function useCreateExpenseCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; color?: string | null }) =>
      gqlRequest<
        { createExpenseCategory: ExpenseCategoryRow },
        { input: { name: string; color?: string | null } }
      >(CREATE_EXPENSE_CATEGORY_MUTATION, { input }).then((data) => data.createExpenseCategory),
    onSuccess: (category) => {
      void queryClient.invalidateQueries({ queryKey: expenseKeys.categories() });
      toast.success(`Category "${category.name}" added`);
    },
    onError: (error) => {
      toast.error("Could not add the category", {
        description: parseApiError(error).message,
      });
    },
  });
}
