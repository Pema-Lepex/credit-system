"use client";

import { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCard } from "@/features/dashboard/components/chart-card";
import { ChartEmpty, ChartPlaceholder } from "@/features/dashboard/components/chart-empty";
import { ChartTooltip } from "@/features/dashboard/components/chart-tooltip";
import { useChartTheme } from "@/features/dashboard/hooks/use-chart-theme";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import type { MonthlyPoint } from "@/features/dashboard/queries";
import { toNumber } from "@/lib/format";

/**
 * How much money is late, over time.
 *
 * ONE series, so there is no legend box — the title already names what is plotted,
 * and a legend with a single swatch just restates it.
 *
 * The area is a ~10% wash of the series hue, not a saturated block: the shape of
 * the trend is the message, and a solid fill drowns it while adding no information.
 */
export function OverdueTrendChart({ data }: { data: MonthlyPoint[] }) {
  const theme = useChartTheme();
  const money = useMoney();
  const gradientId = useId();

  const rows = useMemo(
    () =>
      data.map((point) => ({
        label: point.label,
        overdue: toNumber(point.overdueAmount),
      })),
    [data],
  );

  const hasData = rows.some((row) => row.overdue > 0);

  const table = useMemo(
    () => ({
      caption: "Overdue amount, by month",
      columns: ["Month", "Overdue"],
      rows: data.map((point) => [point.label, money.format(point.overdueAmount)]),
    }),
    [data, money],
  );

  // chart-5 is the rose slot. It reads as alarm without stealing --destructive,
  // which is reserved for status chips and must not double as a chart series.
  const color = theme?.series[4];

  return (
    <ChartCard
      title="Overdue trend"
      description="What was past its due date at the end of each month."
      table={hasData ? table : undefined}
    >
      {!theme || !color ? (
        <ChartPlaceholder />
      ) : !hasData ? (
        <ChartEmpty
          title="Nothing overdue"
          description="Nobody has missed a due date. If that changes, the shape of the problem shows up here."
        />
      ) : (
        <div className="h-64 w-full sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>

              <CartesianGrid vertical={false} stroke={theme.grid} strokeWidth={1} />
              <XAxis
                dataKey="label"
                stroke={theme.grid}
                tick={{ fill: theme.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: theme.grid }}
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
                cursor={{ stroke: theme.grid, strokeWidth: 1 }}
                content={<ChartTooltip formatValue={money.format} />}
              />
              <Area
                dataKey="overdue"
                name="Overdue"
                type="monotone"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                fill={`url(#${gradientId})`}
                activeDot={{ r: 4, strokeWidth: 2, stroke: theme.surface }}
                // See MonthlyChart: the mount animation replays on every refetch.
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
