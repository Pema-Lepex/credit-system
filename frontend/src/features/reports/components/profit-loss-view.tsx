"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import {
  Alert,
  Badge,
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
import {
  useExpenseReport,
  useProfitLoss,
  type ExpenseGroupRow,
  type ProfitLoss,
} from "@/features/reports/api";
import { ReportDownloadButtons } from "@/features/reports/components/report-download-buttons";
import {
  ReportPeriodPicker,
  useReportPeriod,
} from "@/features/reports/components/report-period-picker";
import { useChartColors } from "@/features/reports/lib/chart-theme";
import { useMoneyFormat, type MoneyFormat } from "@/features/settings/api/business";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

/** Money is a string end to end; this is the ONE place it becomes a number, for a chart. */
function toChartNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** formatCurrency's positional signature, applied once so call sites stay readable. */
function asMoney(value: string | number, money: MoneyFormat): string {
  return formatCurrency(value, money.currency, money.locale, {}, money.symbol);
}

export function ProfitLossView() {
  const period = useReportPeriod();
  const money = useMoneyFormat();

  const pl = useProfitLoss(period.input, { enabled: !period.incomplete });
  const expenses = useExpenseReport(period.input, { enabled: !period.incomplete });

  const report = pl.data;
  const expenseReport = expenses.data;
  const isError = pl.isError || expenses.isError;
  const isLoading = (pl.isLoading || expenses.isLoading) && !report;
  const isFetching = pl.isFetching || expenses.isFetching;

  return (
    <div className="space-y-6">
      <ReportPeriodPicker
        state={period}
        actions={
          report ? (
            <ReportDownloadButtons
              datasets={["profit_loss", "expense_summary", "expenses"]}
              dateFrom={report.startDate}
              dateTo={report.endDate}
              filename={`profit-and-loss-${report.startDate}-to-${report.endDate}`}
            />
          ) : null
        }
      />

      {period.incomplete ? (
        <Alert variant="info">Pick a start and an end date to see a custom report.</Alert>
      ) : null}

      {isError ? (
        <Alert variant="destructive" title="Could not load the report">
          {pl.error instanceof Error
            ? pl.error.message
            : expenses.error instanceof Error
              ? expenses.error.message
              : "Please try again."}
        </Alert>
      ) : null}

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
          <Skeleton className="h-80 w-full" />
        </div>
      ) : report ? (
        <div className={cn("space-y-6", isFetching && "opacity-70 transition-opacity")}>
          <ProfitLossStatement report={report} money={money} />

          <div className="grid gap-6 lg:grid-cols-2 *:min-w-0">
            <ExpensePieChart rows={report.expensesByCategory} money={money} />
            <ExpenseGroupTable
              title="Where the money went"
              description="Your spending, biggest bucket first."
              rows={report.expensesByCategory}
              total={report.operatingExpenses}
              money={money}
              nameHeader="Category"
            />
          </div>

          {expenseReport ? (
            <div className="grid gap-6 lg:grid-cols-2 *:min-w-0">
              <ExpenseGroupTable
                title="Who you paid"
                description="Grouped by vendor."
                rows={expenseReport.byVendor}
                total={expenseReport.total}
                money={money}
                nameHeader="Paid to"
              />
              <ExpenseGroupTable
                title="How you paid"
                description="Grouped by payment method."
                rows={expenseReport.byMethod}
                total={expenseReport.total}
                money={money}
                nameHeader="Method"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The statement
// ---------------------------------------------------------------------------
function ProfitLossStatement({
  report,
  money,
}: {
  report: ProfitLoss;
  money: MoneyFormat;
}) {
  const netIsPositive = toChartNumber(report.netProfit) >= 0;

  /**
   * Plain language over accounting jargon, per the spec — a shop owner should not
   * need to know what "COGS" stands for. The formal term is kept as the hint so
   * the report is still recognisable to an accountant.
   */
  const lines: {
    label: string;
    hint?: string;
    value: string;
    tone?: "total" | "subtotal" | "deduction";
  }[] = [
    {
      label: "Money you collected",
      hint: "Payments received in this period",
      value: report.revenue,
    },
    {
      label: "Cost of what you sold",
      hint: "Stock cost of goods given out, at today's cost price",
      value: report.costOfGoodsSold,
      tone: "deduction",
    },
    { label: "Gross profit", value: report.grossProfit, tone: "subtotal" },
    {
      label: "Business expenses",
      hint: "Rent, wages, fuel and everything else",
      value: report.operatingExpenses,
      tone: "deduction",
    },
    { label: "Net profit", value: report.netProfit, tone: "total" },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Profit &amp; loss</CardTitle>
            <CardDescription>
              {report.startDate} to {report.endDate}
            </CardDescription>
          </div>
          {/* The caveat travels with the report, never as a footnote someone can miss. */}
          <Badge variant="neutral">{report.basis}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="divide-border divide-y">
          {lines.map((line) => (
            <div
              key={line.label}
              className={cn(
                "flex items-baseline justify-between gap-4 py-3",
                line.tone === "total" && "border-border border-t-2 pt-4",
              )}
            >
              <dt className="min-w-0">
                <span
                  className={cn(
                    "block",
                    line.tone === "total"
                      ? "text-foreground text-base font-semibold"
                      : line.tone === "subtotal"
                        ? "text-foreground font-medium"
                        : "text-foreground",
                  )}
                >
                  {line.label}
                </span>
                {line.hint ? (
                  <span className="text-muted-foreground block text-xs">{line.hint}</span>
                ) : null}
              </dt>

              <dd
                className={cn(
                  "tabular shrink-0 font-medium",
                  line.tone === "total"
                    ? cn(
                        "text-lg font-semibold",
                        netIsPositive ? "text-success-foreground" : "text-destructive",
                      )
                    : line.tone === "deduction"
                      ? "text-muted-foreground"
                      : "text-foreground",
                )}
              >
                {line.tone === "deduction" ? "− " : ""}
                {asMoney(line.value, money)}
              </dd>
            </div>
          ))}
        </dl>

        <p className="text-muted-foreground text-xs">
          Cash basis: revenue counts money you actually collected in this period, and the cost of
          goods uses each product&apos;s current cost price. It is a management figure to steer by —
          not an official accounting statement.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Charts & tables
// ---------------------------------------------------------------------------
function ExpensePieChart({
  rows,
  money,
}: {
  rows: ExpenseGroupRow[];
  money: MoneyFormat;
}) {
  const colors = useChartColors();
  const data = useMemo(
    () => rows.map((row) => ({ name: row.label, value: toChartNumber(row.total) })),
    [rows],
  );
  const hasData = data.some((point) => point.value > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spending by category</CardTitle>
        <CardDescription>Where your money goes.</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyState
            size="sm"
            title="No expenses in this period"
            description="Record an expense and it will show up here."
          />
        ) : (
          // The wrapper stops Recharts from pushing the page into horizontal scroll
          // on mobile — same guard as the other charts in this feature.
          <div className="h-72 w-full min-w-0 overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={2}
                  isAnimationActive={false}
                >
                  {data.map((point, index) => (
                    <Cell
                      key={point.name}
                      // The owner's own category colour when they picked one;
                      // otherwise the fixed series palette.
                      fill={rows[index]?.color ?? colors.series[index % colors.series.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  // Recharts types the value as ValueType | undefined, so it is
                  // narrowed here rather than asserted.
                  formatter={(value) => asMoney(typeof value === "number" ? value : 0, money)}
                  contentStyle={{
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: "0.5rem",
                    color: colors.foreground,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ExpenseGroupTable({
  title,
  description,
  rows,
  total,
  money,
  nameHeader,
}: {
  title: string;
  description: string;
  rows: ExpenseGroupRow[];
  total: string;
  money: MoneyFormat;
  nameHeader: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState size="sm" title="Nothing to show" description="No expenses in this period." />
        ) : (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{nameHeader}</TableHead>
                  <TableHead align="right">Count</TableHead>
                  <TableHead align="right">Total</TableHead>
                  <TableHead align="right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${nameHeader}-${row.key || row.label}`}>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        {row.color ? (
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: row.color }}
                          />
                        ) : null}
                        <span className="truncate">{row.label}</span>
                      </span>
                    </TableCell>
                    <TableCell numeric>{formatNumber(row.count)}</TableCell>
                    <TableCell numeric>{asMoney(row.total, money)}</TableCell>
                    <TableCell numeric className="text-muted-foreground">
                      {row.sharePct}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-medium">Total</TableCell>
                  <TableCell numeric />
                  <TableCell numeric className="font-semibold">
                    {asMoney(total, money)}
                  </TableCell>
                  <TableCell numeric />
                </TableRow>
              </TableFooter>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}
