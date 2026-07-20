"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useMoney } from "@/features/credits/hooks/use-business-settings";
import { ChartCard, LegendKey } from "@/features/dashboard/components/chart-card";
import { ChartEmpty, ChartPlaceholder } from "@/features/dashboard/components/chart-empty";
import { ChartTooltip } from "@/features/dashboard/components/chart-tooltip";
import { useChartTheme } from "@/features/dashboard/hooks/use-chart-theme";
import type { CashPoint } from "@/features/dashboard/queries";
import { toNumber } from "@/lib/format";

/**
 * Revenue against expenses, by month.
 *
 * ONE AXIS, like every money chart here — both series are money in the same
 * currency, so they share a scale and the comparison is real.
 *
 * The colours are SEMANTIC, not series colours: money in is the positive tone and
 * money out is the negative one. Using chart-1/chart-2 would make "which bar is
 * good" a legend lookup instead of something you can see.
 */
export function RevenueVsExpensesChart({ data }: { data: CashPoint[] }) {
  const theme = useChartTheme();
  const money = useMoney();

  const rows = useMemo(
    () =>
      data.map((point) => ({
        label: point.label,
        // Numbers for GEOMETRY only — every total on this page is summed server-side.
        revenue: toNumber(point.moneyIn),
        expenses: toNumber(point.moneyOut),
      })),
    [data],
  );

  const hasData = rows.some((row) => row.revenue > 0 || row.expenses > 0);

  const table = useMemo(
    () => ({
      caption: "Revenue and expenses, by month",
      columns: ["Month", "Revenue", "Expenses"],
      rows: data.map((point) => [
        point.label,
        money.format(point.moneyIn),
        money.format(point.moneyOut),
      ]),
    }),
    [data, money],
  );

  return (
    <ChartCard
      title="Revenue vs expenses"
      description="What you collected against what you spent, month by month."
      aside={
        theme && hasData ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <LegendKey color={theme.positive} label="Revenue" />
            <LegendKey color={theme.negative} label="Expenses" />
          </div>
        ) : null
      }
      table={hasData ? table : undefined}
    >
      {!theme ? (
        <ChartPlaceholder />
      ) : !hasData ? (
        <ChartEmpty
          title="Nothing to compare yet"
          description="Once you have collected a payment and recorded an expense, this chart shows them side by side."
        />
      ) : (
        <div className="h-64 w-full sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={theme.grid} strokeWidth={1} />
              <XAxis
                dataKey="label"
                stroke={theme.grid}
                tick={{ fill: theme.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: theme.grid }}
                interval="preserveStartEnd"
                minTickGap={8}
              />
              <YAxis
                stroke={theme.grid}
                tick={{ fill: theme.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={(value: number) => money.formatCompact(value)}
              />
              <Tooltip
                cursor={{ fill: theme.grid, fillOpacity: 0.35 }}
                content={<ChartTooltip formatValue={money.format} />}
              />
              <Bar
                dataKey="revenue"
                name="Revenue"
                fill={theme.positive}
                maxBarSize={20}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="expenses"
                name="Expenses"
                fill={theme.negative}
                maxBarSize={20}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

/**
 * Net cash flow over time.
 *
 * A ZERO REFERENCE LINE is the whole point of this chart: the question it answers
 * is "were we above or below water", and without the baseline an area chart of a
 * negative month just looks like a small positive one.
 */
export function CashFlowTrendChart({ data }: { data: CashPoint[] }) {
  const theme = useChartTheme();
  const money = useMoney();

  const rows = useMemo(
    () => data.map((point) => ({ label: point.label, net: toNumber(point.net) })),
    [data],
  );

  const hasData = rows.some((row) => row.net !== 0);
  const everNegative = rows.some((row) => row.net < 0);

  const table = useMemo(
    () => ({
      caption: "Net cash flow, by month",
      columns: ["Month", "Net"],
      rows: data.map((point) => [point.label, money.format(point.net)]),
    }),
    [data, money],
  );

  return (
    <ChartCard
      title="Cash flow trend"
      description="Money in less money out, month by month."
      table={hasData ? table : undefined}
    >
      {!theme ? (
        <ChartPlaceholder />
      ) : !hasData ? (
        <ChartEmpty
          title="No movement yet"
          description="Record a payment or an expense and your cash flow appears here."
        />
      ) : (
        <div className="h-64 w-full sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="cash-flow-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={theme.series[0]} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={theme.series[0]} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={theme.grid} strokeWidth={1} />
              <XAxis
                dataKey="label"
                stroke={theme.grid}
                tick={{ fill: theme.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: theme.grid }}
                interval="preserveStartEnd"
                minTickGap={8}
              />
              <YAxis
                stroke={theme.grid}
                tick={{ fill: theme.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={(value: number) => money.formatCompact(value)}
              />
              <Tooltip
                cursor={{ stroke: theme.grid }}
                content={<ChartTooltip formatValue={money.format} />}
              />
              {/* Only drawn when it means something. On an all-positive series the
                  zero line is just the axis, and the extra ink says nothing. */}
              {everNegative ? (
                <ReferenceLine y={0} stroke={theme.negative} strokeDasharray="3 3" />
              ) : null}
              <Area
                dataKey="net"
                name="Net"
                type="monotone"
                stroke={theme.series[0]}
                strokeWidth={2}
                fill="url(#cash-flow-fill)"
                activeDot={{ r: 4, strokeWidth: 2, stroke: theme.surface }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
