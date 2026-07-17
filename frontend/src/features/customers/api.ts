/**
 * Customer GraphQL documents + the shapes they return.
 *
 * Written against docs/schema.graphql, not guessed. Money fields (`totalCredit`,
 * `outstandingBalance`, `creditLimit`…) are Strings on the wire and stay Strings
 * here — they are formatted at the display edge and never arithmetic'd.
 */

import type {
  CustomerStatus,
  CreditStatus,
  ID,
  ISODateTime,
  Money,
  PaymentMethod,
} from "@/types";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------
export interface PageInfo {
  total: number;
  page: number;
  limit: number;
  pages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface CustomerRecord {
  id: ID;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  photoUrl: string | null;
  photoThumbnailUrl: string | null;
  notes: string | null;
  status: CustomerStatus;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  creditScore: number;
  creditLimit: Money | null;
  totalCredit: Money;
  totalPaid: Money;
  /** Legacy: max(0, credits - payments). Clamped, so an advance is invisible here. */
  outstandingBalance: Money;
  /** What the account ledger says they owe. NOT clamped — negative = paid ahead. */
  ledgerBalance: Money;
  creditCount: number;
  overdueCount: number;
  lastCreditAt: ISODateTime | null;
  lastPaymentAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface CustomerScoreRecord {
  customerId: ID;
  score: number;
  reasons: string[];
}

export interface CustomerCreditRecord {
  id: ID;
  number: string;
  status: CreditStatus;
  grandTotal: Money;
  amountPaid: Money;
  remainingAmount: Money;
  issuedDate: string;
  dueDate: string;
  isOverdue: boolean;
  daysUntilDue: number;
}

export interface CustomerPaymentRecord {
  id: ID;
  number: string;
  creditId: ID;
  creditNumber: string | null;
  amount: Money;
  balanceAfter: Money;
  method: PaymentMethod;
  reference: string | null;
  paidAt: ISODateTime;
  isVoid: boolean;
  voidReason: string | null;
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------
export interface CustomerFilterInput {
  search?: string | null;
  status?: CustomerStatus[] | null;
  minOutstanding?: Money | null;
  maxOutstanding?: Money | null;
  hasOverdue?: boolean | null;
}

export interface PageInput {
  page: number;
  limit: number;
}

export interface SortInput {
  field: string;
  desc: boolean;
}

/** Mirrors `CustomerInput` in the schema. Money in, money out — as strings. */
export interface CustomerInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  photoFileId?: ID | null;
  notes?: string | null;
  status?: CustomerStatus | null;
  creditLimit?: Money | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
const CUSTOMER_FIELDS = /* GraphQL */ `
  fragment CustomerFields on CustomerType {
    id
    code
    name
    phone
    email
    address
    city
    latitude
    longitude
    photoUrl
    photoThumbnailUrl
    notes
    status
    emergencyContactName
    emergencyContactPhone
    emergencyContactRelation
    creditScore
    creditLimit
    totalCredit
    totalPaid
    outstandingBalance
    ledgerBalance
    creditCount
    overdueCount
    lastCreditAt
    lastPaymentAt
    createdAt
  }
`;

export const CUSTOMERS_QUERY = /* GraphQL */ `
  ${CUSTOMER_FIELDS}
  query Customers($filter: CustomerFilterInput, $page: PageInput, $sort: SortInput) {
    customers(filter: $filter, page: $page, sort: $sort) {
      items {
        ...CustomerFields
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

export interface CustomersResult {
  customers: { items: CustomerRecord[]; pageInfo: PageInfo };
}
export interface CustomersVars {
  filter?: CustomerFilterInput;
  page?: PageInput;
  sort?: SortInput;
  [key: string]: unknown;
}

export const CUSTOMER_QUERY = /* GraphQL */ `
  ${CUSTOMER_FIELDS}
  query Customer($id: ID!) {
    customer(id: $id) {
      ...CustomerFields
    }
  }
`;

export interface CustomerResult {
  customer: CustomerRecord;
}

export const CUSTOMER_SCORE_QUERY = /* GraphQL */ `
  query CustomerScore($id: ID!) {
    customerScore(id: $id) {
      customerId
      score
      reasons
    }
  }
`;

export interface CustomerScoreResult {
  customerScore: CustomerScoreRecord;
}

export const CUSTOMER_CREDITS_QUERY = /* GraphQL */ `
  query CustomerCredits($filter: CreditFilterInput, $page: PageInput, $sort: SortInput) {
    credits(filter: $filter, page: $page, sort: $sort) {
      items {
        id
        number
        status
        grandTotal
        amountPaid
        remainingAmount
        issuedDate
        dueDate
        isOverdue
        daysUntilDue
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

export interface CustomerCreditsResult {
  credits: { items: CustomerCreditRecord[]; pageInfo: PageInfo };
}

export const CUSTOMER_PAYMENTS_QUERY = /* GraphQL */ `
  query CustomerPayments($filter: PaymentFilterInput, $page: PageInput, $sort: SortInput) {
    payments(filter: $filter, page: $page, sort: $sort) {
      items {
        id
        number
        creditId
        creditNumber
        amount
        balanceAfter
        method
        reference
        paidAt
        isVoid
        voidReason
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

export interface CustomerPaymentsResult {
  payments: { items: CustomerPaymentRecord[]; pageInfo: PageInfo };
}

export const CREATE_CUSTOMER_MUTATION = /* GraphQL */ `
  ${CUSTOMER_FIELDS}
  mutation CreateCustomer($input: CustomerInput!) {
    createCustomer(input: $input) {
      ...CustomerFields
    }
  }
`;

export interface CreateCustomerResult {
  createCustomer: CustomerRecord;
}

export const UPDATE_CUSTOMER_MUTATION = /* GraphQL */ `
  ${CUSTOMER_FIELDS}
  mutation UpdateCustomer($id: ID!, $input: CustomerInput!) {
    updateCustomer(id: $id, input: $input) {
      ...CustomerFields
    }
  }
`;

export interface UpdateCustomerResult {
  updateCustomer: CustomerRecord;
}

export const DELETE_CUSTOMER_MUTATION = /* GraphQL */ `
  mutation DeleteCustomer($id: ID!) {
    deleteCustomer(id: $id) {
      id
      name
    }
  }
`;

export interface DeleteCustomerResult {
  deleteCustomer: { id: ID; name: string };
}
