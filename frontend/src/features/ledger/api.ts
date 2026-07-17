"use client";

/**
 * The customer account ledger — the passbook, the balance, and paying it down.
 *
 * WHY THIS IS A SEPARATE FEATURE FROM `credits`
 * ---------------------------------------------
 * A credit is a *purchase*: what the customer took, and when. The ledger is the
 * *money*: what they owe as a result. Those are different questions, and conflating
 * them is the modelling error this migration exists to undo (see
 * backend/app/models/ledger.py). Keeping them apart here keeps the seam visible.
 *
 * MONEY IS ALWAYS A STRING on the wire and stays a string here. `amount` keeps its
 * SIGN — positive increases what they owe, negative reduces it — so the UI can put
 * it in the right column without re-deriving anything from the entry type.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { customerKeys } from "@/features/customers/queries";
import { creditKeys } from "@/features/credits/queries";
import { dashboardKeys } from "@/features/dashboard/queries";
import { paymentKeys } from "@/features/payments/queries";
import { gqlRequest } from "@/lib/graphql/client";
import type { PageInfo } from "@/features/customers/api";
import type { ID, ISODateTime, Money } from "@/types";

/** Every way a balance can move. Mirrors LedgerEntryType in the backend enums. */
export const LEDGER_ENTRY_TYPES = [
  "OPENING_BALANCE",
  "CHARGE",
  "PAYMENT",
  "ADJUSTMENT",
  "WRITE_OFF",
  "REVERSAL",
] as const;

export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export interface LedgerEntryRow {
  id: ID;
  /** Posting order. The running balance follows THIS — never sort the passbook by date. */
  seq: number;
  entryType: LedgerEntryType;
  /** Signed: "+30.00" was taken, "-30.00" was paid. */
  amount: Money;
  balanceAfter: Money;
  /** When it happened in the world. May precede postedAt — back-dating is normal. */
  occurredAt: ISODateTime;
  postedAt: ISODateTime;
  memo: string | null;
  creditId: ID | null;
  paymentId: ID | null;
  reversesId: ID | null;
}

export interface LedgerPage {
  items: LedgerEntryRow[];
  pageInfo: PageInfo;
}

export interface AccountPaymentInput {
  customerId: ID;
  amount: string;
  method?: string;
  paidAt?: string | null;
  reference?: string | null;
  notes?: string | null;
}

const CUSTOMER_LEDGER_QUERY = /* GraphQL */ `
  query CustomerLedger($customerId: ID!, $page: PageInput) {
    customerLedger(customerId: $customerId, page: $page) {
      items {
        id
        seq
        entryType
        amount
        balanceAfter
        occurredAt
        postedAt
        memo
        creditId
        paymentId
        reversesId
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

/**
 * Pay the customer's BALANCE. Names no credit — that is the entire point.
 * One entry server-side, whether they have 4 purchases behind them or 40,000.
 */
const RECORD_ACCOUNT_PAYMENT_MUTATION = /* GraphQL */ `
  mutation RecordAccountPayment($input: AccountPaymentInput!) {
    recordAccountPayment(input: $input) {
      id
      number
      amount
      balanceAfter
      method
      paidAt
    }
  }
`;

export const ledgerKeys = {
  all: ["ledger"] as const,
  entries: (customerId: ID, page: number) => ["ledger", "entries", customerId, page] as const,
};

export function useCustomerLedger(customerId: ID, page = 1, limit = 25) {
  return useQuery({
    queryKey: ledgerKeys.entries(customerId, page),
    queryFn: () =>
      gqlRequest<{ customerLedger: LedgerPage }, { customerId: ID; page: { page: number; limit: number } }>(
        CUSTOMER_LEDGER_QUERY,
        { customerId, page: { page, limit } },
      ).then((data) => data.customerLedger),
    // Paging without this flashes a skeleton over a passbook the user is reading.
    placeholderData: keepPreviousData,
  });
}

export interface RecordedPayment {
  id: ID;
  number: string;
  amount: Money;
  /** For an account payment this is the CUSTOMER's balance afterwards. */
  balanceAfter: Money;
  method: string;
  paidAt: ISODateTime;
}

/**
 * Invalidates broadly on purpose. One account payment moves the customer's balance,
 * their passbook, the payments list and the dashboard totals — and during the
 * migration it also moves the legacy aggregates. Reconciling all of that by hand is
 * far more likely to be wrong than a refetch is to be slow.
 */
export function useRecordAccountPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AccountPaymentInput) =>
      gqlRequest<{ recordAccountPayment: RecordedPayment }, { input: AccountPaymentInput }>(
        RECORD_ACCOUNT_PAYMENT_MUTATION,
        { input },
      ).then((data) => data.recordAccountPayment),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
      void queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      void queryClient.invalidateQueries({ queryKey: creditKeys.all });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Quick sale — the counter path
// ---------------------------------------------------------------------------
const QUICK_SALE_MUTATION = /* GraphQL */ `
  mutation QuickSale($input: QuickSaleInput!) {
    quickSale(input: $input) {
      id
      number
      grandTotal
      dueDate
    }
  }
`;

export interface QuickSaleInput {
  customerId: ID;
  amount: string;
  description?: string | null;
  occurredOn?: string | null;
}

export interface QuickSaleResult {
  id: ID;
  number: string;
  grandTotal: Money;
  dueDate: string;
}

/**
 * Record a purchase. Invalidates the same broad set as a payment: a sale moves the
 * balance, the passbook, the credit list and the dashboard.
 */
export function useQuickSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: QuickSaleInput) =>
      gqlRequest<{ quickSale: QuickSaleResult }, { input: QuickSaleInput }>(
        QUICK_SALE_MUTATION,
        { input },
      ).then((data) => data.quickSale),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
      void queryClient.invalidateQueries({ queryKey: creditKeys.all });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Statements — the monthly bill
// ---------------------------------------------------------------------------
export const STATEMENT_STATUSES = ["OPEN", "ISSUED", "SETTLED", "OVERDUE"] as const;
export type StatementStatus = (typeof STATEMENT_STATUSES)[number];

export interface StatementRow {
  id: ID;
  number: string;
  customerId: ID;
  customerName: string | null;
  periodStart: string;
  periodEnd: string;
  openingBalance: Money;
  charges: Money;
  /** POSITIVE — a statement reads "you paid 5,710", never "-5,710". */
  payments: Money;
  closingBalance: Money;
  entryCount: number;
  dueDate: string;
  status: StatementStatus;
  issuedAt: ISODateTime | null;
  settledAt: ISODateTime | null;
}

const STATEMENTS_QUERY = /* GraphQL */ `
  query Statements($customerId: ID, $page: PageInput) {
    statements(customerId: $customerId, page: $page) {
      items {
        id
        number
        customerId
        customerName
        periodStart
        periodEnd
        openingBalance
        charges
        payments
        closingBalance
        entryCount
        dueDate
        status
        issuedAt
        settledAt
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

export const statementKeys = {
  all: ["statements"] as const,
  list: (customerId: ID | null, page: number) => ["statements", customerId, page] as const,
};

export function useStatements(customerId: ID | null, page = 1, limit = 12) {
  return useQuery({
    queryKey: statementKeys.list(customerId, page),
    queryFn: () =>
      gqlRequest<
        { statements: { items: StatementRow[]; pageInfo: PageInfo } },
        { customerId: ID | null; page: { page: number; limit: number } }
      >(STATEMENTS_QUERY, { customerId, page: { page, limit } }).then((data) => data.statements),
    placeholderData: keepPreviousData,
  });
}
