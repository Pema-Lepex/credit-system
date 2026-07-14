/**
 * Credit GraphQL documents, the response types they produce, and the query keys
 * that cache them.
 *
 * The types are hand-narrowed to the fields each document actually selects —
 * `CreditType` in the schema has 25 fields and the list needs 12, so typing the
 * list row as the full domain `Credit` would be a lie that hides a missing field
 * until it renders as `undefined`.
 */

import type {
  CreditStatus,
  ID,
  ISODate,
  ISODateTime,
  ItemKind,
  Money,
  PaymentMethod,
} from "@/types";

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------
export interface PageInfo {
  total: number;
  page: number;
  limit: number;
  pages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface PageInput {
  page: number;
  limit: number;
}

export interface SortInput {
  field: string;
  desc: boolean;
}

/** The columns the backend will actually ORDER BY — see CreditService._apply_sort. */
export const CREDIT_SORT_FIELDS = [
  "created_at",
  "due_date",
  "issued_date",
  "grand_total",
  "remaining_amount",
  "number",
  "status",
] as const;
export type CreditSortField = (typeof CREDIT_SORT_FIELDS)[number];

export interface CreditFilterInput {
  search?: string | null;
  status?: CreditStatus[] | null;
  customerId?: ID | null;
  dueFrom?: ISODate | null;
  dueTo?: ISODate | null;
  issuedFrom?: ISODate | null;
  issuedTo?: ISODate | null;
  minAmount?: Money | null;
  maxAmount?: Money | null;
  overdueOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------
export interface CreditCustomerRef {
  id: ID;
  name: string;
  code: string;
  phone?: string | null;
  email?: string | null;
}

export interface CreditListRow {
  id: ID;
  number: string;
  customerId: ID;
  customer: CreditCustomerRef | null;
  grandTotal: Money;
  amountPaid: Money;
  remainingAmount: Money;
  dueDate: ISODate;
  status: CreditStatus;
  daysUntilDue: number;
  isOverdue: boolean;
  currency: string;
}

export interface CreditItemRow {
  id: ID;
  kind: ItemKind;
  productId: ID | null;
  serviceId: ID | null;
  name: string;
  description: string | null;
  unit: string;
  quantity: Money;
  unitPrice: Money;
  discountAmount: Money;
  taxPercentage: Money;
  taxAmount: Money;
  lineSubtotal: Money;
  lineTotal: Money;
  position: number;
}

export interface CreditPaymentRow {
  id: ID;
  number: string;
  creditId: ID;
  customerId: ID;
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
}

export interface CreditDetail extends CreditListRow {
  subtotal: Money;
  discountAmount: Money;
  taxAmount: Money;
  discountPercentage: Money | null;
  taxPercentage: Money | null;
  issuedDate: ISODate;
  reminderDate: ISODate | null;
  paidAt: ISODateTime | null;
  notes: string | null;
  photoUrls: string[];
  invoiceUrl: string | null;
  items: CreditItemRow[];
  payments: CreditPaymentRow[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface CreditsQueryResult {
  credits: { items: CreditListRow[]; pageInfo: PageInfo };
}

export interface CreditQueryResult {
  credit: CreditDetail;
}

export interface PaymentHistoryResult {
  paymentHistory: CreditPaymentRow[];
}

// ---------------------------------------------------------------------------
// Mutation inputs — mirror the schema's input objects exactly.
// ---------------------------------------------------------------------------
export interface CreditItemInput {
  name: string;
  quantity: Money;
  unitPrice: Money;
  kind: ItemKind;
  productId?: ID | null;
  serviceId?: ID | null;
  description?: string | null;
  unit: string;
  discountAmount: Money;
  taxPercentage: Money;
}

export interface CreditCreateInput {
  customerId: ID;
  items: CreditItemInput[];
  dueDate: ISODate;
  issuedDate?: ISODate | null;
  reminderDate?: ISODate | null;
  discountPercentage?: Money | null;
  taxPercentage?: Money | null;
  notes?: string | null;
  photoFileIds?: ID[] | null;
  invoiceFileId?: ID | null;
  initialPayment?: Money | null;
}

export interface CreditUpdateInput {
  items?: CreditItemInput[] | null;
  dueDate?: ISODate | null;
  reminderDate?: ISODate | null;
  discountPercentage?: Money | null;
  taxPercentage?: Money | null;
  notes?: string | null;
  photoFileIds?: ID[] | null;
  invoiceFileId?: ID | null;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
const CREDIT_LIST_FIELDS = /* GraphQL */ `
  fragment CreditListFields on CreditType {
    id
    number
    customerId
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
    daysUntilDue
    isOverdue
    currency
  }
`;

export const CREDITS_QUERY = /* GraphQL */ `
  ${CREDIT_LIST_FIELDS}
  query Credits($filter: CreditFilterInput, $page: PageInput, $sort: SortInput) {
    credits(filter: $filter, page: $page, sort: $sort) {
      items {
        ...CreditListFields
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

export const CREDIT_QUERY = /* GraphQL */ `
  ${CREDIT_LIST_FIELDS}
  query Credit($id: ID!) {
    credit(id: $id) {
      ...CreditListFields
      customer {
        id
        name
        code
        phone
        email
      }
      subtotal
      discountAmount
      taxAmount
      discountPercentage
      taxPercentage
      issuedDate
      reminderDate
      paidAt
      notes
      photoUrls
      invoiceUrl
      items {
        id
        kind
        productId
        serviceId
        name
        description
        unit
        quantity
        unitPrice
        discountAmount
        taxPercentage
        taxAmount
        lineSubtotal
        lineTotal
        position
      }
      payments {
        id
        number
        creditId
        customerId
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
      }
      createdAt
      updatedAt
    }
  }
`;

/**
 * VOIDED PAYMENTS INCLUDED. The ledger is append-only; the timeline strikes voids
 * through with their reason rather than hiding them, which is the entire point of
 * voiding instead of deleting.
 */
export const PAYMENT_HISTORY_QUERY = /* GraphQL */ `
  query PaymentHistory($creditId: ID!) {
    paymentHistory(creditId: $creditId) {
      id
      number
      creditId
      customerId
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
    }
  }
`;

export const CREATE_CREDIT_MUTATION = /* GraphQL */ `
  mutation CreateCredit($input: CreditCreateInput!) {
    createCredit(input: $input) {
      id
      number
    }
  }
`;

export const UPDATE_CREDIT_MUTATION = /* GraphQL */ `
  mutation UpdateCredit($id: ID!, $input: CreditUpdateInput!) {
    updateCredit(id: $id, input: $input) {
      id
      number
    }
  }
`;

export const CANCEL_CREDIT_MUTATION = /* GraphQL */ `
  mutation CancelCredit($id: ID!, $reason: String) {
    cancelCredit(id: $id, reason: $reason) {
      id
      status
    }
  }
`;

export const DELETE_CREDIT_MUTATION = /* GraphQL */ `
  mutation DeleteCredit($id: ID!) {
    deleteCredit(id: $id) {
      id
      number
    }
  }
`;

export const SEND_REMINDER_MUTATION = /* GraphQL */ `
  mutation SendReminder($creditId: ID!) {
    sendReminder(creditId: $creditId) {
      id
      status
      scheduledFor
    }
  }
`;

// ---------------------------------------------------------------------------
// Supporting lookups — the customer picker and the catalog picker.
// These read other domains, but the *documents* are ours; nothing is shared.
// ---------------------------------------------------------------------------
export interface CustomerOption {
  id: ID;
  name: string;
  code: string;
  phone: string | null;
  outstandingBalance: Money;
  creditLimit: Money | null;
  status: string;
}

export interface CustomerSearchResult {
  customers: { items: CustomerOption[]; pageInfo: PageInfo };
}

export const CUSTOMER_SEARCH_QUERY = /* GraphQL */ `
  query CustomerSearch($filter: CustomerFilterInput, $page: PageInput) {
    customers(filter: $filter, page: $page) {
      items {
        id
        name
        code
        phone
        outstandingBalance
        creditLimit
        status
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

export interface CustomerByIdResult {
  customer: CustomerOption;
}

/**
 * Resolves a customer id from the URL back into a name for the picker. Without it,
 * a shared `?customer=<id>` link would render a filter chip that says nothing.
 */
export const CUSTOMER_BY_ID_QUERY = /* GraphQL */ `
  query CustomerById($id: ID!) {
    customer(id: $id) {
      id
      name
      code
      phone
      outstandingBalance
      creditLimit
      status
    }
  }
`;

export const CREATE_CUSTOMER_MUTATION = /* GraphQL */ `
  mutation CreateCustomerInline($input: CustomerInput!) {
    createCustomer(input: $input) {
      id
      name
      code
      phone
      outstandingBalance
      creditLimit
      status
    }
  }
`;

export interface CatalogEntry {
  id: ID;
  name: string;
  price: Money;
  taxPercentage: Money | null;
  /** Products carry a unit; services do not (the backend has no `unit` on a service). */
  unit: string;
  kind: Extract<ItemKind, "PRODUCT" | "SERVICE">;
  /** Products only — surfaced so the user is not blindsided by a sale of nothing. */
  stockQuantity?: Money | null;
  sku?: string | null;
  code?: string | null;
}

export interface CatalogSearchResult {
  products: {
    items: Array<{
      id: ID;
      name: string;
      sku: string | null;
      price: Money;
      taxPercentage: Money | null;
      unit: string;
      stockQuantity: Money;
      isActive: boolean;
    }>;
  };
  services: {
    items: Array<{
      id: ID;
      name: string;
      code: string | null;
      price: Money;
      taxPercentage: Money | null;
      isActive: boolean;
    }>;
  };
}

/** One round trip for both halves of the catalog — the picker shows them together. */
export const CATALOG_SEARCH_QUERY = /* GraphQL */ `
  query CatalogSearch($search: String, $page: PageInput) {
    products(filter: { search: $search, isActive: true }, page: $page) {
      items {
        id
        name
        sku
        price
        taxPercentage
        unit
        stockQuantity
        isActive
      }
    }
    services(filter: { search: $search, isActive: true }, page: $page) {
      items {
        id
        name
        code
        price
        taxPercentage
        isActive
      }
    }
  }
`;

export interface BusinessSettings {
  id: ID;
  name: string;
  currency: string;
  currencySymbol: string;
  locale: string;
  taxPercentage: Money;
}

export interface BusinessQueryResult {
  business: BusinessSettings;
}

/**
 * Currency, locale and the default tax rate. Everything that renders money needs
 * these, so it is cached with a long staleTime — a business does not change its
 * currency mid-session.
 */
export const BUSINESS_QUERY = /* GraphQL */ `
  query BusinessSettings {
    business {
      id
      name
      currency
      currencySymbol
      locale
      taxPercentage
    }
  }
`;

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export interface CreditsQueryVariables {
  filter: CreditFilterInput;
  page: PageInput;
  sort: SortInput;
}

export const creditKeys = {
  all: ["credits"] as const,
  lists: () => [...creditKeys.all, "list"] as const,
  list: (variables: CreditsQueryVariables) => [...creditKeys.lists(), variables] as const,
  details: () => [...creditKeys.all, "detail"] as const,
  detail: (id: ID) => [...creditKeys.details(), id] as const,
  paymentHistory: (id: ID) => [...creditKeys.all, "payment-history", id] as const,
  customerSearch: (search: string) => [...creditKeys.all, "customer-search", search] as const,
  customerById: (id: ID) => [...creditKeys.all, "customer-by-id", id] as const,
  catalogSearch: (search: string) => [...creditKeys.all, "catalog-search", search] as const,
};

export const businessKeys = {
  settings: ["business", "settings"] as const,
};
