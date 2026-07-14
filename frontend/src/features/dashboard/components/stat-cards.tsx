"use client";

import {
  AlertTriangle,
  CalendarClock,
  CreditCard,
  HandCoins,
  Hourglass,
  TrendingUp,
  Users,
} from "lucide-react";
import { useMemo } from "react";

import { StatCard } from "@/features/dashboard/components/stat-card";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import type { DashboardSummary } from "@/features/dashboard/queries";
import { formatNumber, toNumber } from "@/lib/format";

/** Big money is compacted; a shop-sized number is shown in full. Exact value in the title. */
function useDisplayMoney() {
  const money = useMoney();
  return useMemo(
    () => ({
      ...money,
      display: (amount: string) =>
        toNumber(amount) >= 100_000 ? money.formatCompact(amount) : money.format(amount),
    }),
    [money],
  );
}

/** Today, in the browser's timezone — good enough to seed a date filter link. */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function StatCards({ summary }: { summary: DashboardSummary }) {
  const money = useDisplayMoney();
  const isoToday = today();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Total customers"
        value={formatNumber(summary.totalCustomers, money.locale)}
        icon={<Users />}
        hint={`${formatNumber(summary.activeCustomers, money.locale)} active`}
        href="/customers"
      />

      <StatCard
        label="Total credits"
        value={formatNumber(summary.totalCredits, money.locale)}
        icon={<CreditCard />}
        hint={`${money.format(summary.totalCreditValue)} written`}
        href="/credits"
      />

      <StatCard
        label="Overdue"
        value={money.display(summary.overdueAmount)}
        exactValue={money.format(summary.overdueAmount)}
        icon={<AlertTriangle />}
        tone={summary.overdueCount > 0 ? "destructive" : "neutral"}
        hint={
          summary.overdueCount > 0
            ? `${formatNumber(summary.overdueCount, money.locale)} credit${summary.overdueCount === 1 ? "" : "s"} past due`
            : "Nothing past due"
        }
        href="/credits?overdue=1"
      />

      <StatCard
        label="Due today"
        value={money.display(summary.dueTodayAmount)}
        exactValue={money.format(summary.dueTodayAmount)}
        icon={<CalendarClock />}
        tone={summary.dueTodayCount > 0 ? "warning" : "neutral"}
        hint={
          summary.dueTodayCount > 0
            ? `${formatNumber(summary.dueTodayCount, money.locale)} credit${summary.dueTodayCount === 1 ? "" : "s"} to collect`
            : "Nothing falls due today"
        }
        href={`/credits?dueFrom=${isoToday}&dueTo=${isoToday}`}
      />

      <StatCard
        label="Total revenue"
        value={money.display(summary.totalRevenue)}
        exactValue={money.format(summary.totalRevenue)}
        icon={<HandCoins />}
        tone="success"
        hint="Collected, all time"
        href="/payments"
      />

      <StatCard
        label="Pending revenue"
        value={money.display(summary.pendingRevenue)}
        exactValue={money.format(summary.pendingRevenue)}
        icon={<Hourglass />}
        hint="Still owed to you"
        href="/credits?status=PENDING,PARTIALLY_PAID,OVERDUE"
      />

      {/* The one metric the API gives a baseline for. Everything else on this row
          would need a "previous period" the server does not compute — so they get
          a hint, not an invented arrow. */}
      <StatCard
        label="Collections this month"
        value={money.display(summary.collectionsThisMonth)}
        exactValue={money.format(summary.collectionsThisMonth)}
        icon={<TrendingUp />}
        tone="success"
        hint={`${money.format(summary.collectionsLastMonth)} last month`}
        deltaPercent={summary.collectionsDeltaPercent}
        deltaLabel="vs last month"
        upIsGood
        href="/payments"
      />
    </div>
  );
}
