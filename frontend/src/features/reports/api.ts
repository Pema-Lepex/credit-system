"use client";

/**
 * `report(input)`, `createExport(input)`, `exports(page)`.
 *
 * MONEY IS A STRING. Every total, row and breakdown value below is typed `Money`
 * (= string) and stays a string until it reaches formatCurrency(). The only place
 * a number is derived from it is `toNumber()` at the chart boundary, because
 * Recharts plots numbers — and that conversion is one-way and display-only. No
 * total in this app is ever computed by adding JS floats.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { gqlRequest } from "@/lib/graphql/client";
import type {
  ExportFormat,
  ExportState,
  ID,
  ISODate,
  ISODateTime,
  Money,
  PaymentMethod,
  ReportPeriod,
} from "@/types";
import type { PageInfo } from "@/features/settings/api/users";

export interface ReportRow {
  label: string;
  creditsIssued: Money;
  creditsCount: number;
  collected: Money;
  paymentsCount: number;
}

export interface TopCustomer {
  customerId: ID;
  name: string;
  outstanding: Money;
  totalCredit: Money;
  creditCount: number;
  creditScore: number;
}

export interface MethodBreakdown {
  method: PaymentMethod;
  total: Money;
  count: number;
}

export interface ReportSummary {
  period: ReportPeriod;
  startDate: ISODate;
  endDate: ISODate;
  totalIssued: Money;
  totalIssuedCount: number;
  totalCollected: Money;
  totalCollectedCount: number;
  outstanding: Money;
  overdueAmount: Money;
  overdueCount: number;
  rows: ReportRow[];
  topCustomers: TopCustomer[];
  byMethod: MethodBreakdown[];
}

export interface ReportInput {
  period: ReportPeriod;
  startDate?: ISODate | null;
  endDate?: ISODate | null;
}

// ---------------------------------------------------------------------------
// Accounting reports (expenses + cash-basis P&L)
// ---------------------------------------------------------------------------
export interface ExpenseGroupRow {
  key: string;
  label: string;
  total: Money;
  count: number;
  /** Percentage of the report total, computed server-side. Still a string. */
  sharePct: string;
  color: string | null;
}

export interface ExpenseReport {
  period: ReportPeriod;
  startDate: ISODate;
  endDate: ISODate;
  total: Money;
  count: number;
  byCategory: ExpenseGroupRow[];
  byVendor: ExpenseGroupRow[];
  byMethod: ExpenseGroupRow[];
}

export interface ProfitLoss {
  period: ReportPeriod;
  startDate: ISODate;
  endDate: ISODate;
  revenue: Money;
  costOfGoodsSold: Money;
  grossProfit: Money;
  operatingExpenses: Money;
  netProfit: Money;
  netMarginPct: string;
  expensesByCategory: ExpenseGroupRow[];
  /** Always "Cash basis" — carried in the payload so every surface shows the caveat. */
  basis: string;
}

export interface CashFlowRow {
  bucket: ISODate;
  label: string;
  moneyIn: Money;
  moneyOut: Money;
  net: Money;
}

export interface CashFlow {
  period: ReportPeriod;
  startDate: ISODate;
  endDate: ISODate;
  /** "day" | "week" | "month" — chosen server-side from the range length. */
  granularity: string;
  totalIn: Money;
  totalOut: Money;
  netFlow: Money;
  rows: CashFlowRow[];
}

export interface AgingBucket {
  key: string;
  label: string;
  total: Money;
  count: number;
  sharePct: string;
}

export interface AgingCustomer {
  customerId: ID;
  name: string;
  phone: string | null;
  current: Money;
  days1To30: Money;
  days31To60: Money;
  days61To90: Money;
  days90Plus: Money;
  total: Money;
  oldestDays: number;
}

export interface AgingReport {
  asAt: ISODate;
  totalOutstanding: Money;
  buckets: AgingBucket[];
  customers: AgingCustomer[];
}

export interface TaxRateRow {
  rate: string;
  taxableBase: Money;
  taxAmount: Money;
  lineCount: number;
}

export interface TaxSummary {
  period: ReportPeriod;
  startDate: ISODate;
  endDate: ISODate;
  totalTaxable: Money;
  totalTax: Money;
  totalTaxOnCredits: Money;
  /** False when some tax was charged at credit level, so the breakdown is partial. */
  reconciles: boolean;
  rows: TaxRateRow[];
}

export interface ExportJob {
  id: ID;
  format: ExportFormat;
  state: ExportState;
  datasets: string[];
  rowCount: number;
  sizeBytes: number;
  downloadUrl: string | null;
  expiresAt: ISODateTime | null;
  error: string | null;
  createdAt: ISODateTime;
}

export interface ExportJobPage {
  items: ExportJob[];
  pageInfo: PageInfo;
}

export interface ExportInput {
  format: ExportFormat;
  datasets: string[];
  dateFrom?: ISODate | null;
  dateTo?: ISODate | null;
}

/** The backend's dataset whitelist (app/services/export.py DATASETS), verbatim. */
export const EXPORT_DATASETS = [
  { value: "customers", label: "Customers" },
  { value: "credits", label: "Credits" },
  { value: "payments", label: "Payments" },
  { value: "products", label: "Products" },
  { value: "services", label: "Services" },
  { value: "business", label: "Business details" },
  { value: "reports", label: "Report summary" },
  { value: "expenses", label: "Expenses" },
  { value: "expense_summary", label: "Expense summary" },
  { value: "profit_loss", label: "Profit & loss" },
  { value: "cash_flow", label: "Cash flow" },
  { value: "aging_receivable", label: "Money customers owe" },
  { value: "tax_summary", label: "Tax summary" },
] as const;

const REPORT_QUERY = /* GraphQL */ `
  query Report($input: ReportInput) {
    report(input: $input) {
      period
      startDate
      endDate
      totalIssued
      totalIssuedCount
      totalCollected
      totalCollectedCount
      outstanding
      overdueAmount
      overdueCount
      rows {
        label
        creditsIssued
        creditsCount
        collected
        paymentsCount
      }
      topCustomers {
        customerId
        name
        outstanding
        totalCredit
        creditCount
        creditScore
      }
      byMethod {
        method
        total
        count
      }
    }
  }
`;

const EXPENSE_GROUP_FIELDS = /* GraphQL */ `
  fragment ExpenseGroupFields on ExpenseGroupRow {
    key
    label
    total
    count
    sharePct
    color
  }
`;

const EXPENSE_REPORT_QUERY = /* GraphQL */ `
  ${EXPENSE_GROUP_FIELDS}
  query ExpenseReport($input: ReportInput) {
    expenseReport(input: $input) {
      period
      startDate
      endDate
      total
      count
      byCategory {
        ...ExpenseGroupFields
      }
      byVendor {
        ...ExpenseGroupFields
      }
      byMethod {
        ...ExpenseGroupFields
      }
    }
  }
`;

const PROFIT_LOSS_QUERY = /* GraphQL */ `
  ${EXPENSE_GROUP_FIELDS}
  query ProfitLoss($input: ReportInput) {
    profitLoss(input: $input) {
      period
      startDate
      endDate
      revenue
      costOfGoodsSold
      grossProfit
      operatingExpenses
      netProfit
      netMarginPct
      basis
      expensesByCategory {
        ...ExpenseGroupFields
      }
    }
  }
`;

const CASH_FLOW_QUERY = /* GraphQL */ `
  query CashFlow($input: ReportInput) {
    cashFlow(input: $input) {
      period
      startDate
      endDate
      granularity
      totalIn
      totalOut
      netFlow
      rows {
        bucket
        label
        moneyIn
        moneyOut
        net
      }
    }
  }
`;

const AGING_QUERY = /* GraphQL */ `
  query AgingReceivable($asAt: Date) {
    agingReceivable(asAt: $asAt) {
      asAt
      totalOutstanding
      buckets {
        key
        label
        total
        count
        sharePct
      }
      customers {
        customerId
        name
        phone
        current
        days1To30
        days31To60
        days61To90
        days90Plus
        total
        oldestDays
      }
    }
  }
`;

const TAX_SUMMARY_QUERY = /* GraphQL */ `
  query TaxSummary($input: ReportInput) {
    taxSummary(input: $input) {
      period
      startDate
      endDate
      totalTaxable
      totalTax
      totalTaxOnCredits
      reconciles
      rows {
        rate
        taxableBase
        taxAmount
        lineCount
      }
    }
  }
`;

const EXPORT_FIELDS = /* GraphQL */ `
  fragment ExportJobFields on ExportJobType {
    id
    format
    state
    datasets
    rowCount
    sizeBytes
    downloadUrl
    expiresAt
    error
    createdAt
  }
`;

const EXPORTS_QUERY = /* GraphQL */ `
  ${EXPORT_FIELDS}
  query Exports($page: PageInput) {
    exports(page: $page) {
      items {
        ...ExportJobFields
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

const CREATE_EXPORT_MUTATION = /* GraphQL */ `
  ${EXPORT_FIELDS}
  mutation CreateExport($input: ExportInput!) {
    createExport(input: $input) {
      ...ExportJobFields
    }
  }
`;

const DELETE_EXPORT_MUTATION = /* GraphQL */ `
  mutation DeleteExport($id: ID!) {
    deleteExport(id: $id) {
      success
      message
    }
  }
`;

export const reportKeys = {
  all: ["report"] as const,
  summary: (input: ReportInput) => ["report", "summary", input] as const,
  expenses: (input: ReportInput) => ["report", "expenses", input] as const,
  profitLoss: (input: ReportInput) => ["report", "profit-loss", input] as const,
  cashFlow: (input: ReportInput) => ["report", "cash-flow", input] as const,
  aging: (asAt: ISODate | null) => ["report", "aging", asAt] as const,
  tax: (input: ReportInput) => ["report", "tax", input] as const,
};

export const exportKeys = {
  all: ["exports"] as const,
  list: (page: number) => ["exports", "list", page] as const,
};

export function useReport(input: ReportInput): UseQueryResult<ReportSummary> {
  return useQuery({
    queryKey: reportKeys.summary(input),
    queryFn: async () => {
      const data = await gqlRequest<{ report: ReportSummary }, { input: ReportInput }>(
        REPORT_QUERY,
        {
          input: {
            period: input.period,
            startDate: input.startDate ?? null,
            endDate: input.endDate ?? null,
          },
        },
      );
      return data.report;
    },
    placeholderData: (previous) => previous, // charts hold their shape while refetching
  });
}

function reportVariables(input: ReportInput) {
  return {
    input: {
      period: input.period,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
    },
  };
}

export function useExpenseReport(
  input: ReportInput,
  options?: { enabled?: boolean },
): UseQueryResult<ExpenseReport> {
  return useQuery({
    queryKey: reportKeys.expenses(input),
    queryFn: async () => {
      const data = await gqlRequest<{ expenseReport: ExpenseReport }, { input: ReportInput }>(
        EXPENSE_REPORT_QUERY,
        reportVariables(input),
      );
      return data.expenseReport;
    },
    enabled: options?.enabled ?? true,
    placeholderData: (previous) => previous, // charts hold their shape while refetching
  });
}

export function useProfitLoss(
  input: ReportInput,
  options?: { enabled?: boolean },
): UseQueryResult<ProfitLoss> {
  return useQuery({
    queryKey: reportKeys.profitLoss(input),
    queryFn: async () => {
      const data = await gqlRequest<{ profitLoss: ProfitLoss }, { input: ReportInput }>(
        PROFIT_LOSS_QUERY,
        reportVariables(input),
      );
      return data.profitLoss;
    },
    enabled: options?.enabled ?? true,
    placeholderData: (previous) => previous,
  });
}

export function useCashFlow(
  input: ReportInput,
  options?: { enabled?: boolean },
): UseQueryResult<CashFlow> {
  return useQuery({
    queryKey: reportKeys.cashFlow(input),
    queryFn: async () => {
      const data = await gqlRequest<{ cashFlow: CashFlow }, { input: ReportInput }>(
        CASH_FLOW_QUERY,
        reportVariables(input),
      );
      return data.cashFlow;
    },
    enabled: options?.enabled ?? true,
    placeholderData: (previous) => previous,
  });
}

/**
 * Point-in-time, so it takes an as-at date rather than a period. `null` means
 * "today in the shop's timezone", resolved server-side — the browser's idea of
 * today can be a day out.
 */
export function useAgingReceivable(asAt: ISODate | null = null): UseQueryResult<AgingReport> {
  return useQuery({
    queryKey: reportKeys.aging(asAt),
    queryFn: async () => {
      const data = await gqlRequest<{ agingReceivable: AgingReport }, { asAt: ISODate | null }>(
        AGING_QUERY,
        { asAt },
      );
      return data.agingReceivable;
    },
    placeholderData: (previous) => previous,
  });
}

export function useTaxSummary(
  input: ReportInput,
  options?: { enabled?: boolean },
): UseQueryResult<TaxSummary> {
  return useQuery({
    queryKey: reportKeys.tax(input),
    queryFn: async () => {
      const data = await gqlRequest<{ taxSummary: TaxSummary }, { input: ReportInput }>(
        TAX_SUMMARY_QUERY,
        reportVariables(input),
      );
      return data.taxSummary;
    },
    enabled: options?.enabled ?? true,
    placeholderData: (previous) => previous,
  });
}

export function useExports(page: number): UseQueryResult<ExportJobPage> {
  return useQuery({
    queryKey: exportKeys.list(page),
    queryFn: async () => {
      const data = await gqlRequest<
        { exports: ExportJobPage },
        { page: { page: number; limit: number } }
      >(EXPORTS_QUERY, { page: { page, limit: 10 } });
      return data.exports;
    },
    placeholderData: (previous) => previous,
    // Exports expire on a 24h clock; keep the countdown honest without hammering.
    refetchInterval: 60_000,
  });
}

export function useCreateExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ExportInput) => {
      const data = await gqlRequest<{ createExport: ExportJob }, { input: ExportInput }>(
        CREATE_EXPORT_MUTATION,
        { input },
      );
      return data.createExport;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: exportKeys.all });
      // A new export file counts against the storage quota.
      void queryClient.invalidateQueries({ queryKey: ["storage"] });
    },
  });
}

/**
 * Delete one export for good — the file and its row.
 *
 * Irreversible, so the caller is expected to confirm first. Invalidates `storage`
 * alongside the list: deleting an export is one of the few actions a user takes
 * *specifically* to reclaim quota, and a storage figure that ignores it looks broken.
 */
export function useDeleteExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const data = await gqlRequest<
        { deleteExport: { success: boolean; message: string } },
        { id: string }
      >(DELETE_EXPORT_MUTATION, { id });
      return data.deleteExport;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: exportKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["storage"] });
    },
  });
}
