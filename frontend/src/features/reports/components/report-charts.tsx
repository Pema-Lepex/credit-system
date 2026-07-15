"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@/components/ui";
import type { MethodBreakdown, ReportRow } from "@/features/reports/api";
import { useChartColors } from "@/features/reports/lib/chart-theme";
import type { MoneyFormat } from "@/features/settings/api/business";
import { PAYMENT_METHOD_LABELS, formatCompactCurrency, formatCurrency, toNumber } from "@/lib/utils";

/**
 * The report's two charts.
 *
 * ONE AXIS, ALWAYS. Issued and collected are both money in the same currency, so
 * they share a scale and belong on one chart. A second y-axis would let two
 * unrelated scales imply a relationship that is not in the data — it is the single
 * most common way a chart lies, and it is not used here.
 *
 * Money arrives as a string. `toNumber()` is called ONCE, at this boundary,
 * because Recharts plots numbers; nothing downstream does arithmetic on it.
 */

interface ChartRow {
  label: string;
  issued: number;
  collected: number;
}

export interface TrendChartProps {
  rows: ReportRow[];
  money: MoneyFormat;
}

export function TrendChart({ rows, money }: TrendChartProps) {
  const colors = useChartColors();

  const data = useMemo<ChartRow[]>(
    () =>
      rows.map((row) => ({
        label: row.label,
        issued: toNumber(row.creditsIssued),
        collected: toNumber(row.collected),
      })),
    [rows],
  );

  const hasData = data.some((row) => row.issued > 0 || row.collected > 0);

  // A dense daily report gets a tick every nth label rather than 31 overlapping ones.
  const tickInterval = data.length > 12 ? Math.floor(data.length / 8) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Credit issued vs collected</CardTitle>
        <CardDescription>
          What you lent out, and what came back in, over the period.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyState
            size="sm"
            title="No activity in this period"
            description="Pick a wider date range, or record a credit to see it here."
          />
        ) : (
          // min-w-0 + overflow-hidden: Recharts' ResponsiveContainer can momentarily
          // report a width wider than a narrow viewport and push the whole page into a
          // horizontal scroll. Letting this box shrink and clipping overspill keeps the
          // report within the screen on phones.
          <div className="h-72 w-full min-w-0 overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                {/* Recessive grid: horizontal only. Vertical lines add ink, not meaning. */}
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={colors.grid}
                  vertical={false}
                  opacity={0.6}
                />
                <XAxis
                  dataKey="label"
                  interval={tickInterval}
                  tick={{ fill: colors.axis, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: colors.grid }}
                  tickFormatter={(value: string) =>
                    // "2026-07-14" -> "14 Jul"; leave weekly/monthly labels alone.
                    /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(8) + " " + monthOf(value) : value
                  }
                />
                <YAxis
                  tick={{ fill: colors.axis, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(value: number) =>
                    formatCompactCurrency(value, money.currency, money.locale, money.symbol)
                  }
                />
                <Tooltip
                  contentStyle={{
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                    fontSize: 12,
                    color: colors.foreground,
                  }}
                  labelStyle={{ color: colors.foreground, fontWeight: 600 }}
                  // Recharts types the value as ValueType|undefined; the parameter must
                  // be wider than `number` for the function to stay contravariant.
                  formatter={(value: unknown, name: unknown): [string, string] => [
                    formatCurrency(
                      toNumber(value as string | number),
                      money.currency,
                      money.locale,
                      {},
                      money.symbol,
                    ),
                    String(name),
                  ]}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: colors.axis, paddingTop: 8 }}
                  iconType="plainline"
                />
                {/* 2px lines, ≥8px markers — see the mark spec. */}
                <Line
                  type="monotone"
                  dataKey="issued"
                  name="Issued"
                  stroke={colors.series[0]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: colors.surface }}
                />
                <Line
                  type="monotone"
                  dataKey="collected"
                  name="Collected"
                  stroke={colors.series[2]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: colors.surface }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function monthOf(iso: string): string {
  const index = Number(iso.slice(5, 7)) - 1;
  return MONTHS[index] ?? "";
}

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------
export interface MethodChartProps {
  byMethod: MethodBreakdown[];
  money: MoneyFormat;
}

export function MethodChart({ byMethod, money }: MethodChartProps) {
  const colors = useChartColors();

  const data = useMemo(
    () =>
      byMethod
        .map((entry) => ({
          method: entry.method,
          label: PAYMENT_METHOD_LABELS[entry.method],
          total: toNumber(entry.total),
          count: entry.count,
        }))
        .filter((entry) => entry.total > 0),
    [byMethod],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>How you were paid</CardTitle>
        <CardDescription>Collections in this period, by payment method.</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyState
            size="sm"
            title="No payments in this period"
            description="Payment methods appear here once money comes in."
          />
        ) : (
          <div className="space-y-4">
            <div className="h-56 w-full min-w-0 overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="total"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={82}
                    paddingAngle={2}
                    stroke={colors.surface}
                    strokeWidth={2}
                  >
                    {data.map((entry, index) => (
                      <Cell
                        key={entry.method}
                        fill={colors.series[index % colors.series.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 8,
                      fontSize: 12,
                      color: colors.foreground,
                    }}
                    formatter={(value: unknown, name: unknown): [string, string] => [
                      formatCurrency(
                        toNumber(value as string | number),
                        money.currency,
                        money.locale,
                        {},
                        money.symbol,
                      ),
                      String(name),
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* The legend is a list, direct-labelled with the value — identity and
                magnitude are both readable without decoding the colours. */}
            <ul className="space-y-1.5">
              {data.map((entry, index) => (
                <li key={entry.method} className="flex items-center gap-2 text-sm">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-[3px]"
                    style={{ background: colors.series[index % colors.series.length] }}
                  />
                  <span className="text-foreground flex-1 truncate">{entry.label}</span>
                  <span className="text-muted-foreground tabular text-xs">
                    {entry.count}×
                  </span>
                  <span className="text-foreground tabular font-medium">
                    {formatCurrency(entry.total, money.currency, money.locale, {}, money.symbol)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Top customers
// ---------------------------------------------------------------------------
export interface TopCustomersChartProps {
  customers: { customerId: string; name: string; outstanding: string }[];
  money: MoneyFormat;
}

export function TopCustomersChart({ customers, money }: TopCustomersChartProps) {
  const colors = useChartColors();

  const data = useMemo(
    () =>
      customers
        .map((customer) => ({
          name: customer.name,
          outstanding: toNumber(customer.outstanding),
        }))
        .filter((customer) => customer.outstanding > 0)
        .slice(0, 8),
    [customers],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who owes you the most</CardTitle>
        <CardDescription>Outstanding balance, largest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyState
            size="sm"
            title="Nobody owes you anything"
            description="Enjoy it while it lasts."
          />
        ) : (
          <div
            style={{ height: Math.max(200, data.length * 40) }}
            className="w-full min-w-0 overflow-hidden"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
                barCategoryGap={8}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={colors.grid}
                  horizontal={false}
                  opacity={0.6}
                />
                <XAxis
                  type="number"
                  tick={{ fill: colors.axis, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) =>
                    formatCompactCurrency(value, money.currency, money.locale, money.symbol)
                  }
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tick={{ fill: colors.axis, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: colors.grid, opacity: 0.3 }}
                  contentStyle={{
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                    fontSize: 12,
                    color: colors.foreground,
                  }}
                  formatter={(value: unknown): [string, string] => [
                    formatCurrency(
                      toNumber(value as string | number),
                      money.currency,
                      money.locale,
                      {},
                      money.symbol,
                    ),
                    "Outstanding",
                  ]}
                />
                {/* One series: no legend needed — the title names it. */}
                <Bar
                  dataKey="outstanding"
                  fill={colors.series[0]}
                  radius={[0, 4, 4, 0]}
                  maxBarSize={22}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
