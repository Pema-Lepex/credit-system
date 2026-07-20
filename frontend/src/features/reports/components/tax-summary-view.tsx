"use client";

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
import { useTaxSummary } from "@/features/reports/api";
import { ReportDownloadButtons } from "@/features/reports/components/report-download-buttons";
import {
  ReportPeriodPicker,
  useReportPeriod,
} from "@/features/reports/components/report-period-picker";
import { useMoneyFormat, type MoneyFormat } from "@/features/settings/api/business";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

function asMoney(value: string | number, money: MoneyFormat): string {
  return formatCurrency(value, money.currency, money.locale, {}, money.symbol);
}

export function TaxSummaryView() {
  const period = useReportPeriod();
  const money = useMoneyFormat();

  const query = useTaxSummary(period.input, { enabled: !period.incomplete });
  const report = query.data;

  return (
    <div className="space-y-6">
      <ReportPeriodPicker
        state={period}
        actions={
          report ? (
            <ReportDownloadButtons
              datasets={["tax_summary"]}
              dateFrom={report.startDate}
              dateTo={report.endDate}
              filename={`tax-summary-${report.startDate}-to-${report.endDate}`}
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
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : report ? (
        <div className={cn("space-y-6", query.isFetching && "opacity-70 transition-opacity")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-sm">Sales the tax applies to</p>
                <p className="text-foreground mt-1 text-2xl font-semibold tabular">
                  {asMoney(report.totalTaxable, money)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-sm">Tax charged</p>
                <p className="text-foreground mt-1 text-2xl font-semibold tabular">
                  {asMoney(report.totalTax, money)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* An incomplete breakdown must SAY it is incomplete. Quietly showing a
              per-rate total that is lower than what was billed would be worse than
              showing nothing. */}
          {!report.reconciles ? (
            <Alert variant="warning" title="This breakdown is incomplete">
              Some tax was charged on the credit as a whole rather than on individual items, so it
              cannot be split by rate. Total tax actually billed in this period was{" "}
              <strong>{asMoney(report.totalTaxOnCredits, money)}</strong>.
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>By tax rate</CardTitle>
              <CardDescription>
                Taken from the rate on each item at the time it was sold.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {report.rows.length === 0 ? (
                <EmptyState
                  size="sm"
                  title="No tax charged in this period"
                  description="Set a tax percentage on your products and it will be broken down here."
                />
              ) : (
                <TableContainer>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rate</TableHead>
                        <TableHead align="right">Sales</TableHead>
                        <TableHead align="right">Tax</TableHead>
                        <TableHead align="right">Items</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.rows.map((row) => (
                        <TableRow key={row.rate}>
                          <TableCell className="font-medium tabular">{row.rate}%</TableCell>
                          <TableCell numeric>{asMoney(row.taxableBase, money)}</TableCell>
                          <TableCell numeric>{asMoney(row.taxAmount, money)}</TableCell>
                          <TableCell numeric className="text-muted-foreground">
                            {formatNumber(row.lineCount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="font-medium">Total</TableCell>
                        <TableCell numeric className="font-semibold">
                          {asMoney(report.totalTaxable, money)}
                        </TableCell>
                        <TableCell numeric className="font-semibold">
                          {asMoney(report.totalTax, money)}
                        </TableCell>
                        <TableCell numeric />
                      </TableRow>
                    </TableFooter>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>

          <p className="text-muted-foreground text-xs">
            A summary of what you charged, to help you file. It is not a tax return, and it does
            not account for anything you can reclaim.
          </p>
        </div>
      ) : null}
    </div>
  );
}
