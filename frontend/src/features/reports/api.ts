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
