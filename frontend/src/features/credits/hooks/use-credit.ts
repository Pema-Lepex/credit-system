"use client";

import { useQuery } from "@tanstack/react-query";

import {
  creditKeys,
  CREDIT_QUERY,
  PAYMENT_HISTORY_QUERY,
  type CreditQueryResult,
  type PaymentHistoryResult,
} from "@/features/credits/queries";
import { gqlRequest } from "@/lib/graphql/client";
import type { ID } from "@/types";

export function useCredit(id: ID | null) {
  return useQuery({
    queryKey: creditKeys.detail(id ?? ""),
    queryFn: () => gqlRequest<CreditQueryResult, { id: ID }>(CREDIT_QUERY, { id: id as ID }),
    enabled: Boolean(id),
    select: (data) => data.credit,
  });
}

/**
 * The full ledger for a credit, VOIDS INCLUDED — `credit.payments` is the live
 * set, this is the append-only history the timeline draws.
 */
export function usePaymentHistory(creditId: ID | null) {
  return useQuery({
    queryKey: creditKeys.paymentHistory(creditId ?? ""),
    queryFn: () =>
      gqlRequest<PaymentHistoryResult, { creditId: ID }>(PAYMENT_HISTORY_QUERY, {
        creditId: creditId as ID,
      }),
    enabled: Boolean(creditId),
    select: (data) => data.paymentHistory,
  });
}
