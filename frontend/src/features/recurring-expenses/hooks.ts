"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { toast } from "@/components/ui";
import { parseApiError } from "@/features/credits/lib/errors";
import { dashboardKeys } from "@/features/dashboard/queries";
import { expenseKeys } from "@/features/expenses/queries";
import {
  CREATE_RECURRING_EXPENSE_MUTATION,
  DELETE_RECURRING_EXPENSE_MUTATION,
  RECURRING_EXPENSES_QUERY,
  RUN_RECURRING_EXPENSES_MUTATION,
  SET_RECURRING_EXPENSE_ACTIVE_MUTATION,
  UPDATE_RECURRING_EXPENSE_MUTATION,
  recurringKeys,
  type GenerationResult,
  type RecurringExpenseInput,
  type RecurringExpenseRow,
  type RecurringExpensesQueryResult,
} from "@/features/recurring-expenses/queries";
import { gqlRequest } from "@/lib/graphql/client";
import type { ID } from "@/types";

export function useRecurringExpenses(options?: {
  search?: string;
  isActive?: boolean | null;
}) {
  const search = options?.search ?? "";
  const isActive = options?.isActive ?? null;

  return useQuery({
    queryKey: recurringKeys.list(search, isActive),
    queryFn: () =>
      gqlRequest<RecurringExpensesQueryResult, Record<string, unknown>>(
        RECURRING_EXPENSES_QUERY,
        { search: search.trim() || null, isActive, page: { page: 1, limit: 100 } },
      ),
    placeholderData: keepPreviousData,
    select: (data) => data.recurringExpenses,
  });
}

function useInvalidateRecurringWrites() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: recurringKeys.all });
    // Generating creates real expenses, which move the reports and the dashboard.
    void queryClient.invalidateQueries({ queryKey: expenseKeys.all });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["report"] });
    void queryClient.invalidateQueries({ queryKey: ["cash-accounts"] });
  };
}

export function useCreateRecurringExpense() {
  const invalidate = useInvalidateRecurringWrites();
  return useMutation({
    mutationFn: (input: RecurringExpenseInput) =>
      gqlRequest<
        { createRecurringExpense: RecurringExpenseRow },
        { input: RecurringExpenseInput }
      >(CREATE_RECURRING_EXPENSE_MUTATION, { input }).then(
        (data) => data.createRecurringExpense,
      ),
    onSuccess: (template) => {
      invalidate();
      toast.success(`"${template.name}" scheduled`, {
        description: `Next one is due ${template.nextRun}.`,
      });
    },
  });
}

export function useUpdateRecurringExpense() {
  const invalidate = useInvalidateRecurringWrites();
  return useMutation({
    mutationFn: ({ id, input }: { id: ID; input: RecurringExpenseInput }) =>
      gqlRequest<
        { updateRecurringExpense: RecurringExpenseRow },
        { id: ID; input: RecurringExpenseInput }
      >(UPDATE_RECURRING_EXPENSE_MUTATION, { id, input }).then(
        (data) => data.updateRecurringExpense,
      ),
    onSuccess: () => {
      invalidate();
      toast.success("Repeating bill updated", {
        description: "Bills already recorded stay as they are — only future ones change.",
      });
    },
  });
}

export function useSetRecurringExpenseActive() {
  const invalidate = useInvalidateRecurringWrites();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: ID; isActive: boolean }) =>
      gqlRequest<
        { setRecurringExpenseActive: RecurringExpenseRow },
        { id: ID; isActive: boolean }
      >(SET_RECURRING_EXPENSE_ACTIVE_MUTATION, { id, isActive }).then(
        (data) => data.setRecurringExpenseActive,
      ),
    onSuccess: (template) => {
      invalidate();
      toast.success(template.isActive ? "Resumed" : "Paused", {
        description: template.isActive
          ? "Anything missed while it was paused will be caught up."
          : "It will stop creating expenses until you resume it.",
      });
    },
    onError: (error) => {
      toast.error("Could not change it", { description: parseApiError(error).message });
    },
  });
}

export function useDeleteRecurringExpense() {
  const invalidate = useInvalidateRecurringWrites();
  return useMutation({
    mutationFn: (id: ID) =>
      gqlRequest<
        { deleteRecurringExpense: Pick<RecurringExpenseRow, "id" | "name"> },
        { id: ID }
      >(DELETE_RECURRING_EXPENSE_MUTATION, { id }).then(
        (data) => data.deleteRecurringExpense,
      ),
    onSuccess: (template) => {
      invalidate();
      toast.success(`"${template.name}" stopped`, {
        description: "Bills it already recorded are kept.",
      });
    },
    onError: (error) => {
      toast.error("Could not stop it", { description: parseApiError(error).message });
    },
  });
}

/**
 * Generate anything due right now instead of waiting for tonight.
 *
 * Safe to press repeatedly — the server refuses a duplicate for a date it has
 * already generated, which is what `skipped` counts.
 */
export function useRunRecurringExpenses() {
  const invalidate = useInvalidateRecurringWrites();
  return useMutation({
    mutationFn: () =>
      gqlRequest<{ runRecurringExpenses: GenerationResult }, Record<string, never>>(
        RUN_RECURRING_EXPENSES_MUTATION,
        {} as Record<string, never>,
      ).then((data) => data.runRecurringExpenses),
    onSuccess: (result) => {
      invalidate();
      if (result.created === 0) {
        toast.success("Nothing due right now", {
          description: "Everything up to today has already been recorded.",
        });
        return;
      }
      toast.success(
        `${result.created} expense${result.created === 1 ? "" : "s"} recorded`,
        {
          description: result.capped
            ? "There is more to catch up on — run it again to continue."
            : undefined,
        },
      );
    },
    onError: (error) => {
      toast.error("Could not record the due bills", {
        description: parseApiError(error).message,
      });
    },
  });
}
