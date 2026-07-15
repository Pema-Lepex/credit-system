/**
 * Payment GraphQL documents, response types and query keys.
 *
 * The ledger is append-only: there is no "update payment" mutation and there never
 * will be. A correction is a void (with a reason, which the server requires) plus a
 * fresh payment. That is why `includeVoided` is a filter and not a bug.
 */

import type { ID, ISODate, ISODateTime, Money, PaymentMethod } from "@/types";

import type { PageInfo, PageInput, SortInput } from "@/features/credits/queries";

export type { PageInfo, PageInput, SortInput };

/** The columns PaymentService.list will actually ORDER BY. */
export const PAYMENT_SORT_FIELDS = ["paid_at", "amount", "created_at", "number"] as const;
export type PaymentSortField = (typeof PAYMENT_SORT_FIELDS)[number];

export interface PaymentFilterInput {
  search?: string | null;
  creditId?: ID | null;
  customerId?: ID | null;
  method?: PaymentMethod[] | null;
  dateFrom?: ISODate | null;
  dateTo?: ISODate | null;
  minAmount?: Money | null;
  maxAmount?: Money | null;
  includeVoided?: boolean;
}

export interface PaymentRow {
  id: ID;
  number: string;
  creditId: ID;
  customerId: ID;
  customerName: string | null;
  creditNumber: string | null;
  amount: Money;
  balanceAfter: Money;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  paidAt: ISODateTime;
  receiptUrl: string | null;
  isVoid: boolean;
  voidedAt: ISODateTime | null;
  voidReason: string | null;
  createdAt: ISODateTime;
}

export interface PaymentsQueryResult {
  payments: { items: PaymentRow[]; pageInfo: PageInfo };
}

export interface PaymentInput {
  creditId: ID;
  amount: Money;
  method: PaymentMethod;
  paidAt?: ISODate | null;
  reference?: string | null;
  notes?: string | null;
  receiptFileId?: ID | null;
}

export const PAYMENTS_QUERY = /* GraphQL */ `
  query Payments($filter: PaymentFilterInput, $page: PageInput, $sort: SortInput) {
    payments(filter: $filter, page: $page, sort: $sort) {
      items {
        id
        number
        creditId
        customerId
        customerName
        creditNumber
        amount
        balanceAfter
        method
        reference
        notes
        paidAt
        receiptUrl
        isVoid
        voidedAt
        voidReason
        createdAt
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

/** Overpayment is refused HERE, at the counter — surface the message, never swallow it. */
export const RECORD_PAYMENT_MUTATION = /* GraphQL */ `
  mutation RecordPayment($input: PaymentInput!) {
    recordPayment(input: $input) {
      id
      number
      amount
      balanceAfter
      method
      paidAt
      creditId
    }
  }
`;

/** The reason becomes part of the permanent record. The server requires it. */
export const VOID_PAYMENT_MUTATION = /* GraphQL */ `
  mutation VoidPayment($id: ID!, $reason: String!) {
    voidPayment(id: $id, reason: $reason) {
      id
      number
      isVoid
      voidedAt
      voidReason
      creditId
    }
  }
`;

/**
 * Soft-delete: moves the payment to the Trash rather than destroying it. Its
 * amount comes off the credit's balance immediately, and it can be restored (or
 * permanently deleted) from Settings → Trash. Distinct from voiding, which keeps
 * the row on the ledger, struck through.
 */
export const DELETE_PAYMENT_MUTATION = /* GraphQL */ `
  mutation DeletePayment($id: ID!) {
    deletePayment(id: $id) {
      id
      number
      creditId
    }
  }
`;

export interface PaymentsQueryVariables {
  filter: PaymentFilterInput;
  page: PageInput;
  sort: SortInput;
}

export const paymentKeys = {
  all: ["payments"] as const,
  lists: () => [...paymentKeys.all, "list"] as const,
  list: (variables: PaymentsQueryVariables) => [...paymentKeys.lists(), variables] as const,
  detail: (id: ID) => [...paymentKeys.all, "detail", id] as const,
};
