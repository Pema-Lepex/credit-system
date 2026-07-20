/**
 * Cash account GraphQL documents, types and query keys.
 *
 * `balance` is DERIVED server-side from opening balance + payments in - expenses
 * out, never a stored counter, so it cannot drift. See
 * backend/app/models/cash_account.py. All four figures are `Money` (= string).
 */

import type { ID, ISODateTime, Money } from "@/types";

export interface CashAccountRow {
  id: ID;
  name: string;
  description: string | null;
  openingBalance: Money;
  moneyIn: Money;
  moneyOut: Money;
  balance: Money;
  isActive: boolean;
  sortOrder: number;
  createdAt: ISODateTime;
}

export interface CashAccountInput {
  name?: string | null;
  description?: string | null;
  openingBalance?: Money | null;
  isActive?: boolean | null;
  sortOrder?: number | null;
}

export interface CashAccountsQueryResult {
  cashAccounts: CashAccountRow[];
}

const CASH_ACCOUNT_FIELDS = /* GraphQL */ `
  fragment CashAccountFields on CashAccountType {
    id
    name
    description
    openingBalance
    moneyIn
    moneyOut
    balance
    isActive
    sortOrder
    createdAt
  }
`;

export const CASH_ACCOUNTS_QUERY = /* GraphQL */ `
  ${CASH_ACCOUNT_FIELDS}
  query CashAccounts($isActive: Boolean) {
    cashAccounts(isActive: $isActive) {
      ...CashAccountFields
    }
  }
`;

export const CREATE_CASH_ACCOUNT_MUTATION = /* GraphQL */ `
  ${CASH_ACCOUNT_FIELDS}
  mutation CreateCashAccount($input: CashAccountInput!) {
    createCashAccount(input: $input) {
      ...CashAccountFields
    }
  }
`;

export const UPDATE_CASH_ACCOUNT_MUTATION = /* GraphQL */ `
  ${CASH_ACCOUNT_FIELDS}
  mutation UpdateCashAccount($id: ID!, $input: CashAccountInput!) {
    updateCashAccount(id: $id, input: $input) {
      ...CashAccountFields
    }
  }
`;

export const DELETE_CASH_ACCOUNT_MUTATION = /* GraphQL */ `
  mutation DeleteCashAccount($id: ID!) {
    deleteCashAccount(id: $id) {
      id
      name
    }
  }
`;

export const cashAccountKeys = {
  all: ["cash-accounts"] as const,
  list: (isActive: boolean | null) => [...cashAccountKeys.all, "list", { isActive }] as const,
};
