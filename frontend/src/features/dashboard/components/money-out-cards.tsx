"use client";

import { ArrowDownRight, ArrowLeftRight, Receipt, ShoppingCart, Wallet } from "lucide-react";
import { useMemo } from "react";

import { useMoney } from "@/features/credits/hooks/use-business-settings";
import { StatCard } from "@/features/dashboard/components/stat-card";
import type { DashboardAccounting } from "@/features/dashboard/queries";
import { toNumber } from "@/lib/format";

/** Big money is compacted; a shop-sized number is shown in full. Same rule as StatCards. */
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

/**
 * Today's trading, at a glance.
 *
 * A SEPARATE band from the existing StatCards rather than four more tiles bolted
 * onto it: those answer "how is the business overall", these answer "what happened
 * today". Eight tiles in one grid reads as noise.
 */
export function TodayCards({ accounting }: { accounting: DashboardAccounting }) {
  const money = useDisplayMoney();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Today's sales"
        value={money.display(accounting.todaySales)}
        exactValue={money.format(accounting.todaySales)}
        icon={<ShoppingCart />}
        hint="Credit written today"
        href="/credits"
      />

      <StatCard
        label="Today's collections"
        value={money.display(accounting.todayCollections)}
        exactValue={money.format(accounting.todayCollections)}
        icon={<Wallet />}
        hint="Money you took in"
        href="/payments"
      />

      <StatCard
        label="Today's expenses"
        value={money.display(accounting.todayExpenses)}
        exactValue={money.format(accounting.todayExpenses)}
        icon={<Receipt />}
        hint="Money you paid out"
        href="/expenses"
      />

      <StatCard
        label="Customers owe you"
        value={money.display(accounting.outstandingCredit)}
        exactValue={money.format(accounting.outstandingCredit)}
        icon={<ArrowDownRight />}
        hint="Outstanding across every open credit"
        href="/reports/receivables"
      />
    </div>
  );
}

/**
 * This month's bottom line.
 *
 * `upIsGood` is false on expenses: spending more than last month is not a win, and
 * a green arrow there would be the wrong signal.
 */
export function MonthCards({ accounting }: { accounting: DashboardAccounting }) {
  const money = useDisplayMoney();
  const profit = toNumber(accounting.netProfit);
  const flow = toNumber(accounting.netCashFlow);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Revenue this month"
        value={money.display(accounting.monthRevenue)}
        exactValue={money.format(accounting.monthRevenue)}
        icon={<Wallet />}
        hint="Payments collected"
      />

      <StatCard
        label="Expenses this month"
        value={money.display(accounting.monthExpenses)}
        exactValue={money.format(accounting.monthExpenses)}
        icon={<Receipt />}
        deltaPercent={accounting.expenseDeltaPercent}
        deltaLabel="vs last month"
        upIsGood={false}
        href="/expenses"
      />

      <StatCard
        label="Net cash flow"
        value={money.display(accounting.netCashFlow)}
        exactValue={money.format(accounting.netCashFlow)}
        icon={<ArrowLeftRight />}
        tone={flow < 0 ? "destructive" : "neutral"}
        hint="In less out"
        href="/reports/cash-flow"
      />

      <StatCard
        label="Net profit"
        value={money.display(accounting.netProfit)}
        exactValue={money.format(accounting.netProfit)}
        icon={<ArrowLeftRight />}
        tone={profit < 0 ? "destructive" : "success"}
        hint="After stock cost and expenses"
        href="/reports/profit-loss"
      />
    </div>
  );
}
