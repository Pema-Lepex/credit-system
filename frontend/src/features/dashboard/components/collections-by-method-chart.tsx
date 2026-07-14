"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { ChartCard } from "@/features/dashboard/components/chart-card";
import { ChartEmpty, ChartPlaceholder } from "@/features/dashboard/components/chart-empty";
import { ChartTooltip } from "@/features/dashboard/components/chart-tooltip";
import { methodColor, useChartTheme } from "@/features/dashboard/hooks/use-chart-theme";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import type { MethodBreakdown } from "@/features/dashboard/queries";
import { PAYMENT_METHOD_LABELS } from "@/lib/utils";
import { toNumber } from "@/lib/format";

/**
 * How customers actually pay.
 *
 * A donut is a part-to-whole glance and nothing more: it is only drawn for THREE
 * OR MORE methods. With one or two, the ring is a worse version of the two numbers
 * it is made of, so the rows below carry it alone. (A two-slice pie is a shape you
 * have to decode; two labelled rows are a fact you read.)
 *
 * Colour follows the METHOD, not its rank — see METHOD_COLOR_INDEX. Cash stays
 * indigo whether it is the biggest slice or the smallest, so a reader who learned
 * the ring once can keep reading it.
 */
export function CollectionsByMethodChart({ data }: { data: MethodBreakdown[] }) {
  const theme = useChartTheme();
  const money = useMoney();

  const rows = useMemo(
    () =>
      data
        .map((entry) => ({
          method: entry.method,
          label: PAYMENT_METHOD_LABELS[entry.method],
          total: entry.total,
          count: entry.count,
          value: toNumber(entry.total),
        }))
        .filter((entry) => entry.value > 0)
        .sort((a, b) => b.value - a.value),
    [data],
  );

  const table = useMemo(
    () => ({
      caption: "Collections by payment method",
      columns: ["Method", "Collected", "Payments"],
      rows: rows.map((row) => [row.label, money.format(row.total), String(row.count)]),
    }),
    [rows, money],
  );

  const showDonut = rows.length >= 3;

  return (
    <ChartCard
      title="How customers pay"
      description="Collections this year, split by payment method."
      table={rows.length > 0 ? table : undefined}
    >
      {!theme ? (
        <ChartPlaceholder />
      ) : rows.length === 0 ? (
        <ChartEmpty
          title="No payments recorded"
          description="Record a payment and this shows whether your customers pay in cash, by transfer, or by card."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {showDonut ? (
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    content={
                      <ChartTooltip
                        formatValue={money.format}
                        labelFor={(entry) => {
                          const datum = entry.payload as { label?: string } | undefined;
                          return datum?.label ?? "";
                        }}
                      />
                    }
                  />
                  <Pie
                    data={rows}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="62%"
                    outerRadius="88%"
                    // The gap between segments is the SURFACE showing through, not a
                    // border drawn around each slice.
                    stroke={theme.surface}
                    strokeWidth={2}
                    paddingAngle={2}
                    isAnimationActive={false}
                  >
                    {rows.map((row) => (
                      <Cell key={row.method} fill={methodColor(theme, row.method)} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : null}

          {/* The legend IS the readout. Every value on the ring is also a number
              here, so the tooltip enhances rather than gates. */}
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.method} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: methodColor(theme, row.method) }}
                  />
                  <span className="text-foreground truncate">{row.label}</span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular">
                    ×{row.count}
                  </span>
                </span>
                <span className="text-foreground tabular shrink-0 font-medium">
                  {money.format(row.total)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}
