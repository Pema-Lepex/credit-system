/**
 * Recurring expense ("repeating bill") GraphQL documents, types and query keys.
 *
 * A template is a STANDING INSTRUCTION, not an expense. The nightly job turns it
 * into real expenses as its dates arrive, and generating is idempotent — running
 * it twice cannot charge the shop twice. See backend/app/models/recurring.py.
 */

import type { ExpenseFrequency, ID, ISODate, ISODateTime, Money, PaymentMethod } from "@/types";

import type { ExpenseCategoryRow } from "@/features/expenses/queries";
import type { PageInfo, PageInput } from "@/features/credits/queries";

export type { PageInfo, PageInput };

export interface RecurringExpenseRow {
  id: ID;
  name: string;
  categoryId: ID | null;
  category: ExpenseCategoryRow | null;
  vendorId: ID | null;
  vendorName: string | null;
  cashAccountId: ID | null;
  cashAccountName: string | null;
  amount: Money;
  paymentMethod: PaymentMethod;
  provider: string | null;
  frequency: ExpenseFrequency;
  nextRun: ISODate;
  endDate: ISODate | null;
  isActive: boolean;
  notes: string | null;
  lastRunAt: ISODate | null;
  createdAt: ISODateTime;
}

export interface RecurringExpenseInput {
  name?: string | null;
  amount?: Money | null;
  categoryId?: ID | null;
  vendorId?: ID | null;
  cashAccountId?: ID | null;
  paymentMethod?: PaymentMethod | null;
  provider?: string | null;
  frequency?: ExpenseFrequency | null;
  nextRun?: ISODate | null;
  endDate?: ISODate | null;
  isActive?: boolean | null;
  notes?: string | null;
}

export interface GenerationResult {
  created: number;
  /** Already existed — the unique index refused a duplicate. Not an error. */
  skipped: number;
  capped: number;
}

export interface RecurringExpensesQueryResult {
  recurringExpenses: { items: RecurringExpenseRow[]; pageInfo: PageInfo };
}

const RECURRING_FIELDS = /* GraphQL */ `
  fragment RecurringFields on RecurringExpenseType {
    id
    name
    categoryId
    category {
      id
      name
      color
      isActive
      sortOrder
      description
      createdAt
    }
    vendorId
    vendorName
    cashAccountId
    cashAccountName
    amount
    paymentMethod
    provider
    frequency
    nextRun
    endDate
    isActive
    notes
    lastRunAt
    createdAt
  }
`;

export const RECURRING_EXPENSES_QUERY = /* GraphQL */ `
  ${RECURRING_FIELDS}
  query RecurringExpenses($search: String, $isActive: Boolean, $page: PageInput) {
    recurringExpenses(search: $search, isActive: $isActive, page: $page) {
      items {
        ...RecurringFields
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

export const CREATE_RECURRING_EXPENSE_MUTATION = /* GraphQL */ `
  ${RECURRING_FIELDS}
  mutation CreateRecurringExpense($input: RecurringExpenseInput!) {
    createRecurringExpense(input: $input) {
      ...RecurringFields
    }
  }
`;

export const UPDATE_RECURRING_EXPENSE_MUTATION = /* GraphQL */ `
  ${RECURRING_FIELDS}
  mutation UpdateRecurringExpense($id: ID!, $input: RecurringExpenseInput!) {
    updateRecurringExpense(id: $id, input: $input) {
      ...RecurringFields
    }
  }
`;

export const SET_RECURRING_EXPENSE_ACTIVE_MUTATION = /* GraphQL */ `
  ${RECURRING_FIELDS}
  mutation SetRecurringExpenseActive($id: ID!, $isActive: Boolean!) {
    setRecurringExpenseActive(id: $id, isActive: $isActive) {
      ...RecurringFields
    }
  }
`;

export const DELETE_RECURRING_EXPENSE_MUTATION = /* GraphQL */ `
  mutation DeleteRecurringExpense($id: ID!) {
    deleteRecurringExpense(id: $id) {
      id
      name
    }
  }
`;

export const RUN_RECURRING_EXPENSES_MUTATION = /* GraphQL */ `
  mutation RunRecurringExpenses {
    runRecurringExpenses {
      created
      skipped
      capped
    }
  }
`;

export const recurringKeys = {
  all: ["recurring-expenses"] as const,
  list: (search: string, isActive: boolean | null) =>
    [...recurringKeys.all, "list", { search, isActive }] as const,
};
