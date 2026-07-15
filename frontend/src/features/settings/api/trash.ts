"use client";

/**
 * The Trash: soft-deleted credits and payments, with restore and
 * permanent-delete.
 *
 * WHY THIS EXISTS — deleting a credit or a payment from the operations menu no
 * longer destroys it. It moves the record here, out of every active list and
 * report, but recoverable. Only a *permanent* delete from this screen removes it
 * for good. That mirrors how the business owner asked to work: "when I delete
 * from the operation option don't delete from the system — only once deleted
 * from here should it permanently delete."
 *
 * ADMIN-ONLY — every mutation the backend exposes requires CREDIT_DELETE /
 * PAYMENT_DELETE, which staff do not hold. The nav entry and page are gated the
 * same way so staff never see a door they cannot open.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { gqlRequest } from "@/lib/graphql/client";
import type { CreditStatus, ID, ISODate, ISODateTime, Money, PaymentMethod } from "@/types";
import type { PageInfo } from "./users";

// ---------------------------------------------------------------------------
// Response shapes — narrowed to the columns the Trash tables actually show.
// ---------------------------------------------------------------------------
export interface DeletedCreditRow {
  id: ID;
  number: string;
  customer: { id: ID; name: string; code: string } | null;
  grandTotal: Money;
  amountPaid: Money;
  remainingAmount: Money;
  dueDate: ISODate;
  status: CreditStatus;
  currency: string;
}

export interface DeletedPaymentRow {
  id: ID;
  number: string;
  creditId: ID;
  creditNumber: string | null;
  customerName: string | null;
  amount: Money;
  method: PaymentMethod;
  paidAt: ISODateTime;
}

export interface DeletedCreditPage {
  items: DeletedCreditRow[];
  pageInfo: PageInfo;
}

export interface DeletedPaymentPage {
  items: DeletedPaymentRow[];
  pageInfo: PageInfo;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
const DELETED_CREDITS_QUERY = /* GraphQL */ `
  query DeletedCredits($page: PageInput) {
    deletedCredits(page: $page) {
      items {
        id
        number
        customer {
          id
          name
          code
        }
        grandTotal
        amountPaid
        remainingAmount
        dueDate
        status
        currency
      }
      pageInfo {
        total
        page
        limit
        pages
        hasNext
        hasPrevious
      }
    }
  }
`;

const DELETED_PAYMENTS_QUERY = /* GraphQL */ `
  query DeletedPayments($page: PageInput) {
    deletedPayments(page: $page) {
      items {
        id
        number
        creditId
        creditNumber
        customerName
        amount
        method
        paidAt
      }
      pageInfo {
        total
        page
        limit
        pages
        hasNext
        hasPrevious
      }
    }
  }
`;

const RESTORE_CREDIT_MUTATION = /* GraphQL */ `
  mutation RestoreCredit($id: ID!) {
    restoreCredit(id: $id) {
      id
      number
    }
  }
`;

const PERMANENTLY_DELETE_CREDIT_MUTATION = /* GraphQL */ `
  mutation PermanentlyDeleteCredit($id: ID!) {
    permanentlyDeleteCredit(id: $id) {
      success
      message
    }
  }
`;

const RESTORE_PAYMENT_MUTATION = /* GraphQL */ `
  mutation RestorePayment($id: ID!) {
    restorePayment(id: $id) {
      id
      number
    }
  }
`;

const PERMANENTLY_DELETE_PAYMENT_MUTATION = /* GraphQL */ `
  mutation PermanentlyDeletePayment($id: ID!) {
    permanentlyDeletePayment(id: $id) {
      success
      message
    }
  }
`;

interface MessagePayload {
  success: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const trashKeys = {
  all: ["trash"] as const,
  credits: (page: number) => ["trash", "credits", page] as const,
  payments: (page: number) => ["trash", "payments", page] as const,
};

const PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export function useDeletedCredits(page: number): UseQueryResult<DeletedCreditPage> {
  return useQuery({
    queryKey: trashKeys.credits(page),
    queryFn: async () => {
      const data = await gqlRequest<
        { deletedCredits: DeletedCreditPage },
        { page: { page: number; limit: number } }
      >(DELETED_CREDITS_QUERY, { page: { page, limit: PAGE_SIZE } });
      return data.deletedCredits;
    },
    placeholderData: (previous) => previous,
  });
}

export function useDeletedPayments(page: number): UseQueryResult<DeletedPaymentPage> {
  return useQuery({
    queryKey: trashKeys.payments(page),
    queryFn: async () => {
      const data = await gqlRequest<
        { deletedPayments: DeletedPaymentPage },
        { page: { page: number; limit: number } }
      >(DELETED_PAYMENTS_QUERY, { page: { page, limit: PAGE_SIZE } });
      return data.deletedPayments;
    },
    placeholderData: (previous) => previous,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
/**
 * A restore or a permanent-delete changes the Trash AND the active lists (and,
 * for payments, the credit balances they roll up into). Invalidate broadly so
 * every affected view refetches — cheaper than reasoning about which exact
 * caches moved.
 */
function useInvalidateTrash() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: trashKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["credits"] });
    void queryClient.invalidateQueries({ queryKey: ["payments"] });
  };
}

export function useRestoreCredit() {
  const invalidate = useInvalidateTrash();
  return useMutation({
    mutationFn: async (id: ID) => {
      const data = await gqlRequest<{ restoreCredit: { id: ID; number: string } }, { id: ID }>(
        RESTORE_CREDIT_MUTATION,
        { id },
      );
      return data.restoreCredit;
    },
    onSuccess: invalidate,
  });
}

export function usePermanentlyDeleteCredit() {
  const invalidate = useInvalidateTrash();
  return useMutation({
    mutationFn: async (id: ID) => {
      const data = await gqlRequest<{ permanentlyDeleteCredit: MessagePayload }, { id: ID }>(
        PERMANENTLY_DELETE_CREDIT_MUTATION,
        { id },
      );
      return data.permanentlyDeleteCredit;
    },
    onSuccess: invalidate,
  });
}

export function useRestorePayment() {
  const invalidate = useInvalidateTrash();
  return useMutation({
    mutationFn: async (id: ID) => {
      const data = await gqlRequest<{ restorePayment: { id: ID; number: string } }, { id: ID }>(
        RESTORE_PAYMENT_MUTATION,
        { id },
      );
      return data.restorePayment;
    },
    onSuccess: invalidate,
  });
}

export function usePermanentlyDeletePayment() {
  const invalidate = useInvalidateTrash();
  return useMutation({
    mutationFn: async (id: ID) => {
      const data = await gqlRequest<{ permanentlyDeletePayment: MessagePayload }, { id: ID }>(
        PERMANENTLY_DELETE_PAYMENT_MUTATION,
        { id },
      );
      return data.permanentlyDeletePayment;
    },
    onSuccess: invalidate,
  });
}
