"use client";

import { AlertTriangle, ArrowDownRight, ArrowUpRight, FileText, Wallet } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@/components/ui";
import { useCreateExport, useReport, type ReportSummary } from "@/features/reports/api";
import { ExportsPanel } from "@/features/reports/components/exports-panel";
import {
  MethodChart,
  TopCustomersChart,
  TrendChart,
} from "@/features/reports/components/report-charts";
import { useMoneyFormat, type MoneyFormat } from "@/features/settings/api/business";
import { downloadFile } from "@/features/settings/lib/http";
import { GraphQLRequestError } from "@/lib/graphql/client";
import { creditScoreStyle, cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { REPORT_PERIODS, type ISODate, type ReportPeriod } from "@/types";

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
  CUSTOM: "Custom range",
};

export function ReportsView() {
  const [period, setPeriod] = useState<ReportPeriod>("MONTHLY");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const money = useMoneyFormat();

  // A CUSTOM period with no dates yet would ask the server for a range it cannot
  // resolve — hold the query until both ends are filled in.
  const customIncomplete = period === "CUSTOM" && (startDate === "" || endDate === "");

  const input = useMemo(
    () => ({
      period,
      startDate: period === "CUSTOM" && startDate ? (startDate as ISODate) : null,
      endDate: period === "CUSTOM" && endDate ? (endDate as ISODate) : null,
    }),
    [period, startDate, endDate],
  );

  const { data: report, isLoading, isError, error, isFetching } = useReport(input);

  return (
    <div className="space-y-6">
      {/* --------------------------------------------------------- period picker */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:flex-wrap sm:items-end">
          <FormField label="Period" className="sm:w-48">
            <Select
              value={period}
              onChange={(event) => setPeriod(event.target.value as ReportPeriod)}
              options={REPORT_PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
            />
          </FormField>

          {period === "CUSTOM" ? (
            <>
              <FormField label="From" className="sm:w-44">
                <input
                  type="date"
                  value={startDate}
                  max={endDate || undefined}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
                />
              </FormField>
              <FormField label="To" className="sm:w-44">
                <input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
                />
              </FormField>
            </>
          ) : null}

          <div className="flex flex-1 items-center justify-end gap-3">
            {report ? (
              <p className="text-muted-foreground text-sm">
                {formatDate(report.startDate)} – {formatDate(report.endDate)}
              </p>
            ) : null}
            {report ? <PdfReportButton report={report} /> : null}
          </div>
        </CardContent>
      </Card>

      {customIncomplete ? (
        <Alert variant="info">Pick a start and an end date to see a custom report.</Alert>
      ) : null}

      {isError ? (
        <Alert variant="destructive" title="Could not load the report">
          {error instanceof Error ? error.message : "Please try again."}
        </Alert>
      ) : null}

      {isLoading && !report ? (
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
          <SummaryTiles report={report} money={money} />

          <TrendChart rows={report.rows} money={money} />

          <div className="grid gap-6 lg:grid-cols-2">
            <MethodChart byMethod={report.byMethod} money={money} />
            <TopCustomersChart customers={report.topCustomers} money={money} />
          </div>

          <TopCustomersTable report={report} money={money} />
          <RowsTable report={report} money={money} />
        </div>
      ) : null}

      <ExportsPanel
        dateFrom={report?.startDate ?? null}
        dateTo={report?.endDate ?? null}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary tiles
// ---------------------------------------------------------------------------
function SummaryTiles({ report, money }: { report: ReportSummary; money: MoneyFormat }) {
  const tiles = [
    {
      label: "Issued",
      value: report.totalIssued,
      hint: `${formatNumber(report.totalIssuedCount)} credits`,
      icon: ArrowUpRight,
      tone: "text-info-soft-foreground bg-info-soft",
    },
    {
      label: "Collected",
      value: report.totalCollected,
      hint: `${formatNumber(report.totalCollectedCount)} payments`,
      icon: ArrowDownRight,
      tone: "text-success-soft-foreground bg-success-soft",
    },
    {
      label: "Outstanding",
      value: report.outstanding,
      hint: "Still owed to you",
      icon: Wallet,
      tone: "text-neutral-soft-foreground bg-neutral-soft",
    },
    {
      label: "Overdue",
      value: report.overdueAmount,
      hint: `${formatNumber(report.overdueCount)} past due`,
      icon: AlertTriangle,
      tone: "text-destructive-soft-foreground bg-destructive-soft",
    },
  ];

  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label}>
          <CardContent className="flex items-start justify-between gap-3 pt-6">
            <div className="min-w-0">
              <dt className="text-muted-foreground text-sm font-medium">{tile.label}</dt>
              {/* Money is a string all the way here. formatCurrency takes it as-is. */}
              <dd className="text-foreground mt-1 truncate text-2xl font-semibold tabular">
                {formatCurrency(tile.value, money.currency, money.locale, {}, money.symbol)}
              </dd>
              <p className="text-muted-foreground mt-1 text-xs">{tile.hint}</p>
            </div>
            <span
              aria-hidden="true"
              className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tile.tone)}
            >
              <tile.icon className="size-4" />
            </span>
          </CardContent>
        </Card>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
/**
 * The schema exposes no dedicated "report PDF" query — but ExportFormat includes
 * PDF and the export service ships a `reports` dataset, so a PDF of the report IS
 * available: it is an export job with format PDF. We create it and stream the file
 * straight down, so from the user's side it is simply a download button.
 */
function PdfReportButton({ report }: { report: ReportSummary }) {
  const createExport = useCreateExport();
  const [isWorking, setWorking] = useState(false);

  const download = async () => {
    setWorking(true);
    try {
      const job = await createExport.mutateAsync({
        format: "PDF",
        datasets: ["reports"],
        dateFrom: report.startDate,
        dateTo: report.endDate,
      });

      if (job.state !== "READY") {
        toast.error("The PDF could not be generated.", { description: job.error ?? undefined });
        return;
      }

      await downloadFile(
        `/api/exports/${job.id}/download`,
        `report-${report.startDate}-to-${report.endDate}.pdf`,
      );
      toast.success("Report downloaded.");
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Could not download the report.",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <Button
      variant="outline"
      leftIcon={<FileText />}
      isLoading={isWorking}
      loadingText="Preparing…"
      onClick={() => void download()}
    >
      Download PDF
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
function TopCustomersTable({
  report,
  money,
}: {
  report: ReportSummary;
  money: MoneyFormat;
}) {
  if (report.topCustomers.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top customers</CardTitle>
        <CardDescription>By outstanding balance in this period.</CardDescription>
      </CardHeader>
      <CardContent>
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead align="right">Credits</TableHead>
                <TableHead align="right">Total credit</TableHead>
                <TableHead align="right">Outstanding</TableHead>
                <TableHead>Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.topCustomers.map((customer) => {
                const score = creditScoreStyle(customer.creditScore);
                return (
                  <TableRow key={customer.customerId}>
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell numeric>{formatNumber(customer.creditCount)}</TableCell>
                    <TableCell numeric>
                      {formatCurrency(customer.totalCredit, money.currency, money.locale, {}, money.symbol)}
                    </TableCell>
                    <TableCell numeric>
                      {formatCurrency(customer.outstanding, money.currency, money.locale, {}, money.symbol)}
                    </TableCell>
                    <TableCell>
                      <Badge className={cn(score.className)}>
                        {customer.creditScore} · {score.label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}

function RowsTable({ report, money }: { report: ReportSummary; money: MoneyFormat }) {
  // A daily report over a year is 365 rows of mostly zeros. Show the ones where
  // something actually happened; the chart already carries the shape of the rest.
  const rows = report.rows.filter(
    (row) => row.creditsCount > 0 || row.paymentsCount > 0,
  );

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Breakdown</CardTitle>
        <CardDescription>
          Only periods with activity are listed — {formatNumber(rows.length)} of{" "}
          {formatNumber(report.rows.length)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead align="right">Credits</TableHead>
                <TableHead align="right">Issued</TableHead>
                <TableHead align="right">Payments</TableHead>
                <TableHead align="right">Collected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell numeric>{formatNumber(row.creditsCount)}</TableCell>
                  <TableCell numeric>
                    {formatCurrency(row.creditsIssued, money.currency, money.locale, {}, money.symbol)}
                  </TableCell>
                  <TableCell numeric>{formatNumber(row.paymentsCount)}</TableCell>
                  <TableCell numeric>
                    {formatCurrency(row.collected, money.currency, money.locale, {}, money.symbol)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell numeric>{formatNumber(report.totalIssuedCount)}</TableCell>
                <TableCell numeric>
                  {formatCurrency(report.totalIssued, money.currency, money.locale, {}, money.symbol)}
                </TableCell>
                <TableCell numeric>{formatNumber(report.totalCollectedCount)}</TableCell>
                <TableCell numeric>
                  {formatCurrency(report.totalCollected, money.currency, money.locale, {}, money.symbol)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}
