/**
 * Expense GraphQL documents, response types and query keys.
 *
 * Unlike payments, an expense IS editable: it is the owner's own note about their
 * own money, with no counterparty to argue with, and the realistic failure mode is
 * a typo in last Tuesday's fuel bill. See backend/app/services/expense.py.
 *
 * `expenseDate` is an ISODate, not an ISODateTime — a shop owner records "the rent,
 * on the 1st", and there is no meaningful time of day.
 */

import type { ID, ISODate, ISODateTime, Money, PaymentMethod } from "@/types";

import type { PageInfo, PageInput, SortInput } from "@/features/credits/queries";

export type { PageInfo, PageInput, SortInput };

/** The columns ExpenseService.list will actually ORDER BY. */
export const EXPENSE_SORT_FIELDS = [
  "expense_date",
  "amount",
  "created_at",
  "vendor_name",
] as const;
export type ExpenseSortField = (typeof EXPENSE_SORT_FIELDS)[number];

export interface ExpenseCategoryRow {
  id: ID;
  name: string;
  description: string | null;
  color: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: ISODateTime;
}

export interface ExpenseRow {
  id: ID;
  categoryId: ID | null;
  category: ExpenseCategoryRow | null;
  amount: Money;
  vendorId: ID | null;
  vendorName: string | null;
  cashAccountId: ID | null;
  cashAccountName: string | null;
  recurringTemplateId: ID | null;
  /** Created by a repeating bill. Such expenses are not editable — the server refuses. */
  isGenerated: boolean;
  paymentMethod: PaymentMethod;
  expenseDate: ISODate;
  reference: string | null;
  notes: string | null;
  receiptUrl: string | null;
  createdByUserId: ID | null;
  createdByName: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ExpenseFilterInput {
  search?: string | null;
  categoryId?: ID | null;
  vendorName?: string | null;
  paymentMethod?: PaymentMethod[] | null;
  dateFrom?: ISODate | null;
  dateTo?: ISODate | null;
  minAmount?: Money | null;
  maxAmount?: Money | null;
  createdByUserId?: ID | null;
}

export interface ExpenseInput {
  amount?: Money | null;
  categoryId?: ID | null;
  vendorId?: ID | null;
  cashAccountId?: ID | null;
  vendorName?: string | null;
  paymentMethod?: PaymentMethod | null;
  expenseDate?: ISODate | null;
  reference?: string | null;
  notes?: string | null;
  receiptFileId?: ID | null;
}

export interface ExpensesQueryResult {
  expenses: { items: ExpenseRow[]; pageInfo: PageInfo };
}

export interface ExpenseCategoriesQueryResult {
  expenseCategories: ExpenseCategoryRow[];
}

export interface ExpensesQueryVariables {
  filter: ExpenseFilterInput;
  page: PageInput;
  sort: SortInput;
}

const EXPENSE_FIELDS = /* GraphQL */ `
  fragment ExpenseFields on ExpenseType {
    id
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
    amount
    vendorId
    vendorName
    cashAccountId
    cashAccountName
    recurringTemplateId
    isGenerated
    paymentMethod
    expenseDate
    reference
    notes
    receiptUrl
    createdByUserId
    createdByName
    createdAt
    updatedAt
  }
`;

export const EXPENSES_QUERY = /* GraphQL */ `
  ${EXPENSE_FIELDS}
  query Expenses($filter: ExpenseFilterInput, $page: PageInput, $sort: SortInput) {
    expenses(filter: $filter, page: $page, sort: $sort) {
      items {
        ...ExpenseFields
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

export const EXPENSE_QUERY = /* GraphQL */ `
  ${EXPENSE_FIELDS}
  query Expense($id: ID!) {
    expense(id: $id) {
      ...ExpenseFields
    }
  }
`;

export const EXPENSE_CATEGORIES_QUERY = /* GraphQL */ `
  query ExpenseCategories($search: String, $isActive: Boolean) {
    expenseCategories(search: $search, isActive: $isActive) {
      id
      name
      description
      color
      isActive
      sortOrder
      createdAt
    }
  }
`;

export const CREATE_EXPENSE_MUTATION = /* GraphQL */ `
  ${EXPENSE_FIELDS}
  mutation CreateExpense($input: ExpenseInput!) {
    createExpense(input: $input) {
      ...ExpenseFields
    }
  }
`;

export const UPDATE_EXPENSE_MUTATION = /* GraphQL */ `
  ${EXPENSE_FIELDS}
  mutation UpdateExpense($id: ID!, $input: ExpenseInput!) {
    updateExpense(id: $id, input: $input) {
      ...ExpenseFields
    }
  }
`;

/** Soft-delete: moves the expense to the Trash. Recoverable, and nothing else moves. */
export const DELETE_EXPENSE_MUTATION = /* GraphQL */ `
  mutation DeleteExpense($id: ID!) {
    deleteExpense(id: $id) {
      id
      amount
      expenseDate
    }
  }
`;

export const CREATE_EXPENSE_CATEGORY_MUTATION = /* GraphQL */ `
  mutation CreateExpenseCategory($input: ExpenseCategoryInput!) {
    createExpenseCategory(input: $input) {
      id
      name
      color
      isActive
      sortOrder
      description
      createdAt
    }
  }
`;

export const expenseKeys = {
  all: ["expenses"] as const,
  lists: () => [...expenseKeys.all, "list"] as const,
  list: (variables: ExpensesQueryVariables) => [...expenseKeys.lists(), variables] as const,
  detail: (id: ID) => [...expenseKeys.all, "detail", id] as const,
  categories: () => [...expenseKeys.all, "categories"] as const,
};
