"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { toast } from "@/components/ui";
import { creditKeys } from "@/features/credits/queries";
import { dashboardKeys } from "@/features/dashboard/queries";
import { parseApiError } from "@/features/credits/lib/errors";
import {
  DEFAULT_PAYMENT_LIST_STATE,
  parsePaymentListState,
  serialisePaymentListState,
  toPaymentsQueryVariables,
  type PaymentListState,
} from "@/features/payments/lib/filters";
import {
  DELETE_PAYMENT_MUTATION,
  PAYMENTS_QUERY,
  RECORD_PAYMENT_MUTATION,
  VOID_PAYMENT_MUTATION,
  paymentKeys,
  type PaymentInput,
  type PaymentRow,
  type PaymentsQueryResult,
  type PaymentsQueryVariables,
} from "@/features/payments/queries";
import { gqlRequest } from "@/lib/graphql/client";
import type { ID } from "@/types";

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
export interface PaymentListStateController {
  state: PaymentListState;
  update: (patch: Partial<PaymentListState>) => void;
  reset: () => void;
}

export function usePaymentListState(): PaymentListStateController {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo(
    () => parsePaymentListState(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const update = useCallback(
    (patch: Partial<PaymentListState>) => {
      const isPaging = "page" in patch || "limit" in patch;
      const next: PaymentListState = { ...state, ...patch };
      if (!isPaging) next.page = 1;

      const query = serialisePaymentListState(next);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, state],
  );

  const reset = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  return { state, update, reset };
}

export function usePayments(variables: PaymentsQueryVariables) {
  return useQuery({
    queryKey: paymentKeys.list(variables),
    queryFn: () =>
      gqlRequest<PaymentsQueryResult, Record<string, unknown>>(PAYMENTS_QUERY, {
        filter: variables.filter,
        page: variables.page,
        sort: variables.sort,
      }),
    placeholderData: keepPreviousData,
    select: (data) => data.payments,
  });
}

export function usePaymentList() {
  const controller = usePaymentListState();
  const variables = useMemo(
    () => toPaymentsQueryVariables(controller.state),
    [controller.state],
  );
  const query = usePayments(variables);
  return { ...controller, query, variables, defaults: DEFAULT_PAYMENT_LIST_STATE };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
/**
 * A payment moves money, so it moves everything derived from money: the credit's
 * remaining balance and status, the customer's outstanding total and credit score,
 * every dashboard card, and the ledger itself. Invalidate all of it — a stale
 * "remaining" on the screen where the shopkeeper just took cash is the one lie
 * this app must never tell.
 */
function useInvalidatePaymentWrites() {
  const queryClient = useQueryClient();

  // `null` is a real value here, not an oversight: an ACCOUNT payment names no
  // credit, so there is no credit detail or payment history to refresh — only the
  // customer's balance, which the unconditional invalidations above already cover.
  return (creditId?: ID | null) => {
    void queryClient.invalidateQueries({ queryKey: paymentKeys.all });
    void queryClient.invalidateQueries({ queryKey: creditKeys.lists() });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["customers"] });
    if (creditId) {
      void queryClient.invalidateQueries({ queryKey: creditKeys.detail(creditId) });
      void queryClient.invalidateQueries({ queryKey: creditKeys.paymentHistory(creditId) });
    }
  };
}

export function useRecordPayment() {
  const invalidate = useInvalidatePaymentWrites();

  return useMutation({
    mutationFn: (input: PaymentInput) =>
      gqlRequest<{ recordPayment: PaymentRow }, { input: PaymentInput }>(
        RECORD_PAYMENT_MUTATION,
        { input },
      ).then((data) => data.recordPayment),
    onSuccess: (payment) => {
      invalidate(payment.creditId);
      toast.success(`Payment ${payment.number} recorded`);
    },
    // Errors are NOT toasted here. Overpayment comes back as a CONFLICT with a
    // message that names the exact settling amount — the dialog puts that on the
    // amount field, where the user is already looking. A toast would bury it.
  });
}

export function useVoidPayment() {
  const invalidate = useInvalidatePaymentWrites();

  return useMutation({
    mutationFn: ({ id, reason }: { id: ID; reason: string }) =>
      gqlRequest<{ voidPayment: PaymentRow }, { id: ID; reason: string }>(VOID_PAYMENT_MUTATION, {
        id,
        reason,
      }).then((data) => data.voidPayment),
    onSuccess: (payment) => {
      invalidate(payment.creditId);
      toast.success(`Payment ${payment.number} voided`, {
        description: "It stays on the ledger, struck through, with your reason attached.",
      });
    },
    onError: (error) => {
      toast.error("Could not void the payment", {
        description: parseApiError(error).message,
      });
    },
  });
}

/**
 * Delete a payment to the Trash (soft-delete). Reverses its amount off the
 * credit immediately; recoverable from Settings → Trash. Admin-only on the
 * server (PAYMENT_DELETE).
 */
export function useDeletePayment() {
  const invalidate = useInvalidatePaymentWrites();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: ID) =>
      gqlRequest<{ deletePayment: PaymentRow }, { id: ID }>(DELETE_PAYMENT_MUTATION, { id }).then(
        (data) => data.deletePayment,
      ),
    onSuccess: (payment) => {
      invalidate(payment.creditId);
      void queryClient.invalidateQueries({ queryKey: ["trash"] });
      toast.success(`Payment ${payment.number} moved to Trash`, {
        description: "Its amount is back on the credit. Restore it any time from Settings → Trash.",
      });
    },
    onError: (error) => {
      toast.error("Could not delete the payment", {
        description: parseApiError(error).message,
      });
    },
  });
}
