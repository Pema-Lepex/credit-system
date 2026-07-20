"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { toast } from "@/components/ui";
import {
  CASH_ACCOUNTS_QUERY,
  CREATE_CASH_ACCOUNT_MUTATION,
  DELETE_CASH_ACCOUNT_MUTATION,
  UPDATE_CASH_ACCOUNT_MUTATION,
  cashAccountKeys,
  type CashAccountInput,
  type CashAccountRow,
  type CashAccountsQueryResult,
} from "@/features/cash-accounts/queries";
import { parseApiError } from "@/features/credits/lib/errors";
import { expenseKeys } from "@/features/expenses/queries";
import { gqlRequest } from "@/lib/graphql/client";
import type { ID } from "@/types";

export function useCashAccounts(options?: { isActive?: boolean | null }) {
  const isActive = options?.isActive ?? null;
  return useQuery({
    queryKey: cashAccountKeys.list(isActive),
    queryFn: () =>
      gqlRequest<CashAccountsQueryResult, { isActive: boolean | null }>(CASH_ACCOUNTS_QUERY, {
        isActive,
      }).then((data) => data.cashAccounts),
    // Balances move whenever a payment or expense lands, so this is NOT given a
    // long staleTime the way the category picker is.
  });
}

function useInvalidateCashAccountWrites() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: cashAccountKeys.all });
    // Deleting an account unassigns the expenses that pointed at it.
    void queryClient.invalidateQueries({ queryKey: expenseKeys.all });
  };
}

export function useCreateCashAccount() {
  const invalidate = useInvalidateCashAccountWrites();
  return useMutation({
    mutationFn: (input: CashAccountInput) =>
      gqlRequest<{ createCashAccount: CashAccountRow }, { input: CashAccountInput }>(
        CREATE_CASH_ACCOUNT_MUTATION,
        { input },
      ).then((data) => data.createCashAccount),
    onSuccess: (account) => {
      invalidate();
      toast.success(`"${account.name}" added`);
    },
  });
}

export function useUpdateCashAccount() {
  const invalidate = useInvalidateCashAccountWrites();
  return useMutation({
    mutationFn: ({ id, input }: { id: ID; input: CashAccountInput }) =>
      gqlRequest<{ updateCashAccount: CashAccountRow }, { id: ID; input: CashAccountInput }>(
        UPDATE_CASH_ACCOUNT_MUTATION,
        { id, input },
      ).then((data) => data.updateCashAccount),
    onSuccess: () => {
      invalidate();
      toast.success("Account updated");
    },
  });
}

export function useDeleteCashAccount() {
  const invalidate = useInvalidateCashAccountWrites();
  return useMutation({
    mutationFn: (id: ID) =>
      gqlRequest<{ deleteCashAccount: Pick<CashAccountRow, "id" | "name"> }, { id: ID }>(
        DELETE_CASH_ACCOUNT_MUTATION,
        { id },
      ).then((data) => data.deleteCashAccount),
    onSuccess: (account) => {
      invalidate();
      toast.success(`"${account.name}" removed`, {
        description: "Your payments and expenses are all still there — they just aren't assigned to it any more.",
      });
    },
    onError: (error) => {
      toast.error("Could not remove the account", {
        description: parseApiError(error).message,
      });
    },
  });
}
