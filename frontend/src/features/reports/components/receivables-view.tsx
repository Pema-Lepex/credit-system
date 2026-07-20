"use client";

import { Phone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  FormField,
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
import { useAgingReceivable, type AgingCustomer } from "@/features/reports/api";
import { ReportDownloadButtons } from "@/features/reports/components/report-download-buttons";
import { useMoneyFormat, type MoneyFormat } from "@/features/settings/api/business";
import { cn, formatCurrency, toNumber } from "@/lib/utils";

function asMoney(value: string | number, money: MoneyFormat): string {
  return formatCurrency(value, money.currency, money.locale, {}, money.symbol);
}

/**
 * How late is "bad". Drives the colour of the oldest-days badge so the list can be
 * triaged at a glance rather than read.
 */
function agingTone(days: number): "neutral" | "warning" | "destructive" {
  if (days <= 0) return "neutral";
  if (days <= 30) return "warning";
  return "destructive";
}

export function ReceivablesView() {
  // A point-in-time report: no period picker, just the as-at date. Blank means
  // "today in the shop's timezone", resolved server-side.
  const [asAt, setAsAt] = useState("");
  const money = useMoneyFormat();

  const query = useAgingReceivable(asAt || null);
  const report = query.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xs flex-1">
              <FormField
                label="As at"
                description="Leave blank for today. Set a past date to reproduce an earlier report."
              >
                <input
                  type="date"
                  value={asAt}
                  onChange={(event) => setAsAt(event.target.value)}
                  className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
                />
              </FormField>
            </div>

            {report ? (
              <ReportDownloadButtons
                datasets={["aging_receivable"]}
                dateFrom={null}
                // The export reads `end` as the as-at date — point-in-time, not a range.
                dateTo={report.asAt}
                filename={`money-customers-owe-${report.asAt}`}
              />
            ) : null}
          </div>
        </CardContent>
      </Card>

      {query.isError ? (
        <Alert variant="destructive" title="Could not load the report">
          {query.error instanceof Error ? query.error.message : "Please try again."}
        </Alert>
      ) : query.isLoading && !report ? (
        <div className="space-y-6">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : report ? (
        <div className={cn("space-y-6", query.isFetching && "opacity-70 transition-opacity")}>
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-sm">Total owed to you</p>
              <p className="text-foreground mt-1 text-3xl font-semibold tabular">
                {asMoney(report.totalOutstanding, money)}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">as at {report.asAt}</p>
            </CardContent>
          </Card>

          {/* The ladder. Order is meaning here — left is fine, right is trouble. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {report.buckets.map((bucket) => (
              <Card key={bucket.key}>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground text-xs">{bucket.label}</p>
                  <p
                    className={cn(
                      "mt-1 text-xl font-semibold tabular",
                      bucket.key === "D90_PLUS" && toNumber(bucket.total) > 0 && "text-destructive",
                    )}
                  >
                    {asMoney(bucket.total, money)}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {bucket.count} credit{bucket.count === 1 ? "" : "s"} · {bucket.sharePct}%
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Who owes you</CardTitle>
              <CardDescription>
                Oldest debt first — that is the order worth working down.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {report.customers.length === 0 ? (
                <EmptyState
                  size="sm"
                  title="Nobody owes you anything"
                  description="Every credit is settled. Enjoy it."
                />
              ) : (
                <>
                  <TableContainer className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Customer</TableHead>
                          <TableHead align="right">Not due</TableHead>
                          <TableHead align="right">1-30</TableHead>
                          <TableHead align="right">31-60</TableHead>
                          <TableHead align="right">61-90</TableHead>
                          <TableHead align="right">90+</TableHead>
                          <TableHead align="right">Total</TableHead>
                          <TableHead>Oldest</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.customers.map((customer) => (
                          <TableRow key={customer.customerId}>
                            <TableCell>
                              <Link
                                href={`/customers/${customer.customerId}`}
                                className="text-foreground hover:text-primary focus-visible:ring-ring rounded-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
                              >
                                {customer.name}
                              </Link>
                              {customer.phone ? (
                                <span className="text-muted-foreground block text-xs">
                                  {customer.phone}
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell numeric>{asMoney(customer.current, money)}</TableCell>
                            <TableCell numeric>{asMoney(customer.days1To30, money)}</TableCell>
                            <TableCell numeric>{asMoney(customer.days31To60, money)}</TableCell>
                            <TableCell numeric>{asMoney(customer.days61To90, money)}</TableCell>
                            <TableCell
                              numeric
                              className={cn(
                                toNumber(customer.days90Plus) > 0 && "text-destructive font-medium",
                              )}
                            >
                              {asMoney(customer.days90Plus, money)}
                            </TableCell>
                            <TableCell numeric className="font-semibold">
                              {asMoney(customer.total, money)}
                            </TableCell>
                            <TableCell>
                              <Badge size="sm" variant={agingTone(customer.oldestDays)}>
                                {customer.oldestDays === 0
                                  ? "On time"
                                  : `${customer.oldestDays}d`}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell className="font-medium">Total</TableCell>
                          <TableCell colSpan={5} />
                          <TableCell numeric className="font-semibold">
                            {asMoney(report.totalOutstanding, money)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </TableContainer>

                  {/* --------------------------------------------------- mobile */}
                  <ul className="space-y-3 md:hidden">
                    {report.customers.map((customer) => (
                      <MobileRow key={customer.customerId} customer={customer} money={money} />
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function MobileRow({ customer, money }: { customer: AgingCustomer; money: MoneyFormat }) {
  return (
    <li className="border-border bg-card rounded-lg border p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/customers/${customer.customerId}`}
            className="text-foreground truncate font-medium"
          >
            {customer.name}
          </Link>
          {customer.phone ? (
            <a
              href={`tel:${customer.phone}`}
              className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs"
            >
              <Phone aria-hidden="true" className="size-3" />
              {customer.phone}
            </a>
          ) : null}
        </div>
        <p className="text-foreground shrink-0 font-semibold tabular">
          {asMoney(customer.total, money)}
        </p>
      </div>

      <div className="mt-3">
        <Badge size="sm" variant={agingTone(customer.oldestDays)}>
          {customer.oldestDays === 0 ? "On time" : `${customer.oldestDays} days overdue`}
        </Badge>
      </div>
    </li>
  );
}
