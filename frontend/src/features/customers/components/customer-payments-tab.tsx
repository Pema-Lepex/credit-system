"use client";

import { Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  Alert,
  Badge,
  Card,
  CardContent,
  EmptyState,
  Pagination,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from "@/components/ui";
import { toServerError } from "@/features/common/errors";
import { useCurrency } from "@/features/common/use-currency";
import { PAYMENT_METHOD_LABELS, cn, formatDateTime } from "@/lib/utils";
import type { ID } from "@/types";

import { useCustomerPayments } from "../queries";

/**
 * Voided payments are SHOWN, struck through — the ledger is append-only and the
 * backend returns them deliberately (see `paymentHistory`'s docstring). Hiding
 * them would make the running balance look like it jumped for no reason.
 */
export function CustomerPaymentsTab({ customerId }: { customerId: ID }) {
  const currency = useCurrency();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  const { data, isLoading, isFetching, error } = useCustomerPayments(customerId, { page, limit });

  if (error) {
    return (
      <Alert variant="destructive" title="Could not load payments">
        {toServerError(error).message}
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <SkeletonTable rows={4} columns={5} />
        </CardContent>
      </Card>
    );
  }

  const payments = data?.items ?? [];

  if (payments.length === 0) {
    return (
      <Card>
        <CardContent className="p-5 sm:p-6">
          <EmptyState
            size="sm"
            icon={<Receipt />}
            title="No payments yet"
            description="Nothing has been collected from this customer."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <TableContainer className={cn(isFetching && "opacity-60 transition-opacity")}>
        <Table aria-label="Payment history">
          <TableHeader>
            <TableRow>
              <TableHead>Receipt</TableHead>
              <TableHead>Credit</TableHead>
              <TableHead>Method</TableHead>
              <TableHead align="right">Amount</TableHead>
              <TableHead>Paid</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((payment) => (
              <TableRow key={payment.id} className={cn(payment.isVoid && "opacity-60")}>
                <TableCell>
                  <span
                    className={cn(
                      "text-foreground font-medium tabular-nums",
                      payment.isVoid && "line-through",
                    )}
                  >
                    {payment.number}
                  </span>
                  {payment.isVoid ? (
                    <Tooltip content={payment.voidReason ?? "Voided"}>
                      <Badge variant="destructive" size="sm" className="ml-2 cursor-help">
                        Voided
                      </Badge>
                    </Tooltip>
                  ) : null}
                  {payment.reference ? (
                    <p className="text-muted-foreground truncate text-xs">{payment.reference}</p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/credits/${payment.creditId}`}
                    className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm tabular-nums focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {payment.creditNumber ?? "—"}
                  </Link>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground text-sm">
                    {PAYMENT_METHOD_LABELS[payment.method]}
                  </span>
                </TableCell>
                <TableCell numeric>
                  <span className={cn("font-medium", payment.isVoid && "line-through")}>
                    {currency.format(payment.amount)}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground text-sm whitespace-nowrap">
                    {formatDateTime(payment.paidAt)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Pagination
        page={page}
        pageSize={limit}
        totalItems={data?.pageInfo.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(next) => {
          setLimit(next);
          setPage(1);
        }}
        pageSizeOptions={[10, 25, 50]}
        isLoading={isFetching}
      />
    </div>
  );
}
