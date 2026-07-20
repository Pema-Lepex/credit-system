"use client";

import { AlertTriangle, Receipt } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import { ChartEmpty, ChartPlaceholder } from "@/features/dashboard/components/chart-empty";
import { ChartCard, LegendKey } from "@/features/dashboard/components/chart-card";
import { useChartTheme } from "@/features/dashboard/hooks/use-chart-theme";
import type {
  ExpenseCategorySlice,
  OverdueCustomer,
  RecentExpense,
} from "@/features/dashboard/queries";
import { formatDate } from "@/lib/utils";
import { toNumber } from "@/lib/format";

/**
 * Where this month's money went.
 *
 * Slices are coloured from the owner's OWN category colours where they set one,
 * falling back to the fixed series palette. A shop that colour-codes "Rent" red
 * should see red here too.
 */
export function TopExpenseCategoriesChart({ data }: { data: ExpenseCategorySlice[] }) {
  const theme = useChartTheme();
  const money = useMoney();

  const rows = useMemo(
    () => data.map((slice) => ({ name: slice.label, value: toNumber(slice.total) })),
    [data],
  );
  const hasData = rows.some((row) => row.value > 0);

  const table = useMemo(
    () => ({
      caption: "Top expense categories this month",
      columns: ["Category", "Total", "Share"],
      rows: data.map((slice) => [slice.label, money.format(slice.total), `${slice.sharePct}%`]),
    }),
    [data, money],
  );

  return (
    <ChartCard
      title="Top expense categories"
      description="Where this month's money went."
      table={hasData ? table : undefined}
      aside={
        theme && hasData ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {data.slice(0, 3).map((slice, index) => (
              <LegendKey
                key={slice.key || slice.label}
                color={slice.color ?? theme.series[index % theme.series.length]}
                label={slice.label}
              />
            ))}
          </div>
        ) : null
      }
    >
      {!theme ? (
        <ChartPlaceholder />
      ) : !hasData ? (
        <ChartEmpty
          title="No expenses this month"
          description="Record what the business spends and it is broken down here."
        />
      ) : (
        <div className="h-64 w-full min-w-0 overflow-hidden sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={rows}
                dataKey="value"
                nameKey="name"
                innerRadius="55%"
                outerRadius="80%"
                paddingAngle={2}
                isAnimationActive={false}
              >
                {rows.map((row, index) => (
                  <Cell
                    key={row.name}
                    fill={data[index]?.color ?? theme.series[index % theme.series.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => money.format(String(typeof value === "number" ? value : 0))}
                contentStyle={{
                  background: theme.surface,
                  border: `1px solid ${theme.grid}`,
                  borderRadius: "0.5rem",
                  color: theme.foreground,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export function RecentExpenses({ expenses }: { expenses: RecentExpense[] }) {
  const money = useMoney();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Recent expenses</CardTitle>
        <Link
          href="/expenses"
          className="text-muted-foreground hover:text-foreground text-xs font-medium"
        >
          View all
        </Link>
      </CardHeader>
      <CardContent>
        {expenses.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <Receipt aria-hidden="true" className="size-4" />
            Nothing recorded yet.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {expenses.map((expense) => (
              <li key={expense.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-foreground truncate text-sm font-medium">
                    {expense.vendorName ?? expense.category?.name ?? "Expense"}
                  </p>
                  <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    {expense.category ? (
                      <>
                        <span
                          aria-hidden="true"
                          className="size-1.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: expense.category.color ?? "var(--muted-foreground)",
                          }}
                        />
                        {expense.category.name} ·{" "}
                      </>
                    ) : null}
                    {formatDate(expense.expenseDate)}
                  </p>
                </div>
                <p className="text-foreground shrink-0 text-sm font-semibold tabular">
                  {money.format(expense.amount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Who is actually late, worst first.
 *
 * Sourced from the aging report, so "overdue" means the same thing here as it does
 * on the receivables page — two definitions of late would be worse than one list.
 */
export function OverdueCustomers({ customers }: { customers: OverdueCustomer[] }) {
  const money = useMoney();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Chase these first</CardTitle>
        <Link
          href="/reports/receivables"
          className="text-muted-foreground hover:text-foreground text-xs font-medium"
        >
          View all
        </Link>
      </CardHeader>
      <CardContent>
        {customers.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <AlertTriangle aria-hidden="true" className="size-4" />
            Nobody is overdue. Nice.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {customers.map((customer) => (
              <li
                key={customer.customerId}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/customers/${customer.customerId}`}
                    className="text-foreground hover:text-primary truncate text-sm font-medium"
                  >
                    {customer.name}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    {customer.phone ?? "No phone number"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-foreground text-sm font-semibold tabular">
                    {money.format(customer.total)}
                  </p>
                  <Badge
                    size="sm"
                    variant={customer.oldestDays > 30 ? "destructive" : "warning"}
                    className="mt-0.5"
                  >
                    {customer.oldestDays}d late
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
