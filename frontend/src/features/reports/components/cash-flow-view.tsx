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

import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { useCashFlow } from "@/features/reports/api";
import { ReportDownloadButtons } from "@/features/reports/components/report-download-buttons";
import {
  ReportPeriodPicker,
  useReportPeriod,
} from "@/features/reports/components/report-period-picker";
import { useChartColors } from "@/features/reports/lib/chart-theme";
import { useMoneyFormat, type MoneyFormat } from "@/features/settings/api/business";
import { cn, formatCurrency, toNumber } from "@/lib/utils";

function asMoney(value: string | number, money: MoneyFormat): string {
  return formatCurrency(value, money.currency, money.locale, {}, money.symbol);
}

export function CashFlowView() {
  const period = useReportPeriod();
  const money = useMoneyFormat();
  const colors = useChartColors();

  const query = useCashFlow(period.input, { enabled: !period.incomplete });
  const report = query.data;

  const chartRows = useMemo(
    () =>
      (report?.rows ?? []).map((row) => ({
        label: row.label,
        in: toNumber(row.moneyIn),
        out: toNumber(row.moneyOut),
        net: toNumber(row.net),
      })),
    [report],
  );

  const hasActivity = chartRows.some((r) => r.in > 0 || r.out > 0);
  const netIsPositive = toNumber(report?.netFlow ?? "0") >= 0;

  return (
    <div className="space-y-6">
      <ReportPeriodPicker
        state={period}
        actions={
          report ? (
            <ReportDownloadButtons
              datasets={["cash_flow"]}
              dateFrom={report.startDate}
              dateTo={report.endDate}
              filename={`cash-flow-${report.startDate}-to-${report.endDate}`}
            />
          ) : null
        }
      />

      {period.incomplete ? (
        <Alert variant="info">Pick a start and an end date to see a custom range.</Alert>
      ) : null}

      {query.isError ? (
        <Alert variant="destructive" title="Could not load the report">
          {query.error instanceof Error ? query.error.message : "Please try again."}
        </Alert>
      ) : query.isLoading && !report ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
          <Skeleton className="h-80 w-full" />
        </div>
      ) : report ? (
        <div className={cn("space-y-6", query.isFetching && "opacity-70 transition-opacity")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryTile label="Money in" hint="Payments you collected" value={report.totalIn} money={money} />
            <SummaryTile label="Money out" hint="Expenses you paid" value={report.totalOut} money={money} />
            <SummaryTile
              label="Net"
              hint={netIsPositive ? "You took in more than you spent" : "You spent more than you took in"}
              value={report.netFlow}
              money={money}
              tone={netIsPositive ? "positive" : "negative"}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Cash flow over time</CardTitle>
              <CardDescription>
                Grouped by {report.granularity}. Bars are money in and out; the line is the net.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!hasActivity ? (
                <EmptyState
                  size="sm"
                  title="Nothing moved in this period"
                  description="Record a payment or an expense and it will show up here."
                />
              ) : (
                <div className="h-72 w-full min-w-0 overflow-hidden">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke={colors.grid} strokeWidth={1} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: colors.axis, fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: colors.grid }}
                        interval="preserveStartEnd"
                        minTickGap={8}
                      />
                      <YAxis
                        tick={{ fill: colors.axis, fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={64}
                        tickFormatter={(value: number) => asMoney(value, money)}
                      />
                      <Tooltip
                        formatter={(value) => asMoney(typeof value === "number" ? value : 0, money)}
                        contentStyle={{
                          background: colors.surface,
                          border: `1px solid ${colors.border}`,
                          borderRadius: "0.5rem",
                          color: colors.foreground,
                        }}
                      />
                      {/* Semantic tones, not series colours: in is good, out is not. */}
                      <Bar dataKey="in" name="In" fill={colors.positive} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="out" name="Out" fill={colors.negative} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      <Line
                        dataKey="net"
                        name="Net"
                        type="monotone"
                        stroke={colors.series[0]}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Period by period</CardTitle>
            </CardHeader>
            <CardContent>
              <TableContainer>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead align="right">In</TableHead>
                      <TableHead align="right">Out</TableHead>
                      <TableHead align="right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.map((row) => (
                      <TableRow key={row.bucket}>
                        <TableCell className="tabular">{row.label}</TableCell>
                        <TableCell numeric>{asMoney(row.moneyIn, money)}</TableCell>
                        <TableCell numeric>{asMoney(row.moneyOut, money)}</TableCell>
                        <TableCell
                          numeric
                          className={cn(
                            toNumber(row.net) < 0 && "text-destructive",
                          )}
                        >
                          {asMoney(row.net, money)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-medium">Total</TableCell>
                      <TableCell numeric className="font-semibold">
                        {asMoney(report.totalIn, money)}
                      </TableCell>
                      <TableCell numeric className="font-semibold">
                        {asMoney(report.totalOut, money)}
                      </TableCell>
                      <TableCell
                        numeric
                        className={cn("font-semibold", !netIsPositive && "text-destructive")}
                      >
                        {asMoney(report.netFlow, money)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function SummaryTile({
  label,
  hint,
  value,
  money,
  tone,
}: {
  label: string;
  hint: string;
  value: string;
  money: MoneyFormat;
  tone?: "positive" | "negative";
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-muted-foreground text-sm">{label}</p>
        <p
          className={cn(
            "mt-1 text-2xl font-semibold tabular",
            tone === "positive" && "text-success-foreground",
            tone === "negative" && "text-destructive",
          )}
        >
          {asMoney(value, money)}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}
