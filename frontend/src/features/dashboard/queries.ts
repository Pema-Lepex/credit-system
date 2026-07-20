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

export interface CashPoint {
  bucket: ISODate;
  label: string;
  moneyIn: Money;
  moneyOut: Money;
  net: Money;
}

export interface ExpenseCategorySlice {
  key: string;
  label: string;
  total: Money;
  count: number;
  sharePct: string;
  color: string | null;
}

/**
 * The money-out half. A separate block from `summary`, which knows nothing about
 * expenses — see backend/app/services/accounting.py.
 */
export interface DashboardAccounting {
  todaySales: Money;
  todayCollections: Money;
  todayExpenses: Money;
  outstandingCredit: Money;
  monthRevenue: Money;
  monthExpenses: Money;
  monthCogs: Money;
  netCashFlow: Money;
  /** Same definition as the P&L report — revenue less COGS less expenses. */
  netProfit: Money;
  /** Null means "no baseline", NOT 0% — same rule as collectionsDeltaPercent. */
  expenseDeltaPercent: number | null;
  /** 12 months, oldest first. Feeds Revenue-vs-Expenses AND the cash flow trend. */
  monthly: CashPoint[];
  topExpenseCategories: ExpenseCategorySlice[];
}

export interface RecentExpense {
  id: ID;
  amount: Money;
  vendorName: string | null;
  expenseDate: ISODate;
  category: { id: ID; name: string; color: string | null } | null;
}

export interface OverdueCustomer {
  customerId: ID;
  name: string;
  phone: string | null;
  total: Money;
  oldestDays: number;
}

export interface Dashboard {
  summary: DashboardSummary;
  monthly: MonthlyPoint[];
  overdueTrend: MonthlyPoint[];
  topCustomers: TopCustomer[];
  latestActivity: ActivityItem[];
  upcomingDue: UpcomingDueCredit[];
  collectionsByMethod: MethodBreakdown[];
  accounting: DashboardAccounting;
  recentExpenses: RecentExpense[];
  overdueCustomers: OverdueCustomer[];
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
      accounting {
        todaySales
        todayCollections
        todayExpenses
        outstandingCredit
        monthRevenue
        monthExpenses
        monthCogs
        netCashFlow
        netProfit
        expenseDeltaPercent
        monthly {
          bucket
          label
          moneyIn
          moneyOut
          net
        }
        topExpenseCategories {
          key
          label
          total
          count
          sharePct
          color
        }
      }
      recentExpenses {
        id
        amount
        vendorName
        expenseDate
        category {
          id
          name
          color
        }
      }
      overdueCustomers {
        customerId
        name
        phone
        total
        oldestDays
      }
    }
  }
`;

export const dashboardKeys = {
  all: ["dashboard"] as const,
};
