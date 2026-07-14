"use client";

import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCard, LegendKey } from "@/features/dashboard/components/chart-card";
import { ChartTooltip } from "@/features/dashboard/components/chart-tooltip";
import { ChartEmpty, ChartPlaceholder } from "@/features/dashboard/components/chart-empty";
import { useChartTheme } from "@/features/dashboard/hooks/use-chart-theme";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import type { MonthlyPoint } from "@/features/dashboard/queries";
import { toNumber } from "@/lib/format";

/**
 * Credit issued vs collected, by month.
 *
 * ONE AXIS. Both series are money in the same currency, so they share a scale and
 * the comparison is real. A second y-axis would let the two lines be scaled into
 * any relationship you like — which is why this chart never gets one.
 *
 * Bars carry the magnitude that was *issued* (a stock of new debt); the line
 * carries what came *back* (a flow). Different marks for different kinds of
 * quantity, on one scale.
 */
export function MonthlyChart({ data }: { data: MonthlyPoint[] }) {
  const theme = useChartTheme();
  const money = useMoney();

  const rows = useMemo(
    () =>
      data.map((point) => ({
        label: point.label,
        month: point.month,
        // Numbers for GEOMETRY only. No arithmetic happens on them — the totals on
        // this page all come from the server, already summed in integer minor units.
        issued: toNumber(point.creditIssued),
        collected: toNumber(point.collected),
      })),
    [data],
  );

  const hasData = rows.some((row) => row.issued > 0 || row.collected > 0);

  const table = useMemo(
    () => ({
      caption: "Credit issued and collected, by month",
      columns: ["Month", "Issued", "Collected"],
      rows: data.map((point) => [
        point.label,
        money.format(point.creditIssued),
        money.format(point.collected),
      ]),
    }),
    [data, money],
  );

  return (
    <ChartCard
      title="Issued vs collected"
      description="New credit written against cash actually received."
      aside={
        theme && hasData ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <LegendKey color={theme.series[0]} label="Issued" />
            <LegendKey color={theme.series[2]} label="Collected" shape="line" />
          </div>
        ) : null
      }
      table={hasData ? table : undefined}
      className="lg:col-span-2"
    >
      {!theme ? (
        <ChartPlaceholder />
      ) : !hasData ? (
        <ChartEmpty
          title="No credit issued yet"
          description="Once you write your first credit, this chart shows what you issued each month against what you collected."
        />
      ) : (
        <div className="h-64 w-full sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              {/* Horizontal rules only, hairline, solid. Vertical rules add ink that
                  carries no information when the x-axis is already categorical. */}
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
                dataKey="issued"
                name="Issued"
                fill={theme.series[0]}
                // Cap the bar rather than filling the band — the leftover is air.
                maxBarSize={24}
                radius={[4, 4, 0, 0]}
                // No grow-from-zero animation: it replays on every background
                // refetch, which reads as the chart "reloading" when nothing changed.
                isAnimationActive={false}
              />
              <Line
                dataKey="collected"
                name="Collected"
                type="monotone"
                stroke={theme.series[2]}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                // The 2px surface ring keeps the active dot legible where it crosses
                // a bar, and enlarges the hit target.
                activeDot={{ r: 4, strokeWidth: 2, stroke: theme.surface }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
