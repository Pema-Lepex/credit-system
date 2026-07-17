"use client";

/**
 * A customer's monthly statements.
 *
 * One row per month, and the only thing in the product with a due date a customer
 * actually agreed to. This is what replaces four hundred per-purchase due dates and
 * four hundred reminders with "your July account, Nu.9,880, due 10 August".
 *
 * Each row states the month's whole story in the order a person reads it:
 * brought forward, took, paid, owes.
 */

import { CalendarClock } from "lucide-react";
import { useState } from "react";

import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  Pagination,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { useStatements, type StatementRow, type StatementStatus } from "@/features/ledger/api";
import { useCurrency } from "@/features/common/use-currency";
import { formatDate } from "@/lib/utils";
import type { ID } from "@/types";

/** Statement state, in words a shopkeeper uses. Never the raw enum. */
const STATUS: Record<StatementStatus, { label: string; variant: "neutral" | "info" | "success" | "destructive" }> = {
  OPEN: { label: "Open", variant: "neutral" },
  ISSUED: { label: "Awaiting payment", variant: "info" },
  SETTLED: { label: "Paid", variant: "success" },
  OVERDUE: { label: "Overdue", variant: "destructive" },
};

export function StatementsPanel({ customerId }: { customerId: ID }) {
  const [page, setPage] = useState(1);
  const statements = useStatements(customerId, page);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-border border-b p-4">
          <h3 className="text-foreground text-sm font-semibold">Monthly statements</h3>
          <p className="text-muted-foreground text-xs">
            One bill a month — this is what carries the due date.
          </p>
        </div>

        {statements.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : statements.data && statements.data.items.length > 0 ? (
          <>
            <StatementTable rows={statements.data.items} />
            {statements.data.pageInfo.pages > 1 && (
              <div className="border-border border-t p-3">
                <Pagination
                  page={statements.data.pageInfo.page}
                  pageSize={statements.data.pageInfo.limit}
                  totalItems={statements.data.pageInfo.total}
                  onPageChange={setPage}
                  isLoading={statements.isFetching}
                />
              </div>
            )}
          </>
        ) : (
          <div className="p-4">
            <EmptyState
              size="sm"
              icon={<CalendarClock />}
              title="No statements yet"
              description="Statements are issued when a month closes. Turn them on in Settings if you want monthly billing."
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatementTable({ rows }: { rows: StatementRow[] }) {
  const currency = useCurrency();

  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            <TableHead align="right">Brought forward</TableHead>
            <TableHead align="right">Took</TableHead>
            <TableHead align="right">Paid</TableHead>
            <TableHead align="right">Owes</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const status = STATUS[row.status];
            return (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">
                  <span className="text-foreground text-sm font-medium">
                    {new Date(row.periodStart).toLocaleDateString(undefined, {
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                  <span className="text-muted-foreground block font-mono text-xs">
                    {row.number} · {row.entryCount}{" "}
                    {row.entryCount === 1 ? "entry" : "entries"}
                  </span>
                </TableCell>
                <TableCell numeric>{currency.format(row.openingBalance)}</TableCell>
                <TableCell numeric>{currency.format(row.charges)}</TableCell>
                <TableCell numeric className="text-success">
                  {currency.format(row.payments)}
                </TableCell>
                <TableCell numeric className="font-semibold">
                  {currency.format(row.closingBalance)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {formatDate(row.dueDate)}
                </TableCell>
                <TableCell>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
