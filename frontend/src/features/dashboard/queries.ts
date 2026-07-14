/**
 * The dashboard, in one round trip.
 *
 * `dashboard` returns everything the page draws — seven widgets, one query. Seven
 * separate queries would mean seven spinners settling at different moments, which
 * is what makes a dashboard feel like it is still loading long after it has loaded.
 */

import type {
  CreditStatus,
  ID,
  ISODate,
  ISODateTime,
  Money,
  PaymentMethod,
} from "@/types";

export interface DashboardSummary {
  totalCustomers: number;
  activeCustomers: number;
  totalCredits: number;
  totalCreditValue: Money;
  overdueCount: number;
  overdueAmount: Money;
  dueTodayCount: number;
  dueTodayAmount: Money;
  totalRevenue: Money;
  pendingRevenue: Money;
  collectionsThisMonth: Money;
  collectionsLastMonth: Money;
  /**
   * The ONLY delta the API computes — and it is nullable, because a business with
   * no collections last month has no baseline to be a percentage of. Null means
   * "no baseline", NOT "0%". Render a dash; a green arrow here would be a lie.
   */
  collectionsDeltaPercent: number | null;
  currency: string;
  currencySymbol: string;
}

export interface MonthlyPoint {
  month: string; // "2026-07"
  label: string; // "Jul"
  creditIssued: Money;
  collected: Money;
  overdueAmount: Money;
}

export interface TopCustomer {
  customerId: ID;
  name: string;
  outstanding: Money;
  totalCredit: Money;
  creditCount: number;
  creditScore: number;
}

export interface ActivityItem {
  /** "credit" | "payment" — a unified feed, so the kind decides the icon and the link. */
  kind: string;
  id: ID;
  label: string;
  amount: Money;
  customerName: string;
  at: ISODateTime;
}

export interface UpcomingDueCredit {
  id: ID;
  number: string;
  dueDate: ISODate;
  daysUntilDue: number;
  remainingAmount: Money;
  status: CreditStatus;
  customer: { id: ID; name: string } | null;
}

export interface MethodBreakdown {
  method: PaymentMethod;
  total: Money;
  count: number;
}

export interface Dashboard {
  summary: DashboardSummary;
  monthly: MonthlyPoint[];
  overdueTrend: MonthlyPoint[];
  topCustomers: TopCustomer[];
  latestActivity: ActivityItem[];
  upcomingDue: UpcomingDueCredit[];
  collectionsByMethod: MethodBreakdown[];
}

export interface DashboardQueryResult {
  dashboard: Dashboard;
}

export const DASHBOARD_QUERY = /* GraphQL */ `
  query Dashboard {
    dashboard {
      summary {
        totalCustomers
        activeCustomers
        totalCredits
        totalCreditValue
        overdueCount
        overdueAmount
        dueTodayCount
        dueTodayAmount
        totalRevenue
        pendingRevenue
        collectionsThisMonth
        collectionsLastMonth
        collectionsDeltaPercent
        currency
        currencySymbol
      }
      monthly {
        month
        label
        creditIssued
        collected
        overdueAmount
      }
      overdueTrend {
        month
        label
        overdueAmount
      }
      topCustomers {
        customerId
        name
        outstanding
        totalCredit
        creditCount
        creditScore
      }
      latestActivity {
        kind
        id
        label
        amount
        customerName
        at
      }
      upcomingDue {
        id
        number
        dueDate
        daysUntilDue
        remainingAmount
        status
        customer {
          id
          name
        }
      }
      collectionsByMethod {
        method
        total
        count
      }
    }
  }
`;

export const dashboardKeys = {
  all: ["dashboard"] as const,
};
