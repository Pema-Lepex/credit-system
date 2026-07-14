"use client";

import { CreditCard } from "lucide-react";
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
  buttonVariants,
} from "@/components/ui";
import { toServerError } from "@/features/common/errors";
import { useCurrency } from "@/features/common/use-currency";
import { useAuth } from "@/lib/auth/AuthProvider";
import { CREDIT_STATUS_STYLES, cn, formatDate, formatDueDate } from "@/lib/utils";
import type { ID } from "@/types";

import { useCustomerCredits } from "../queries";

const DUE_TONE = {
  neutral: "text-muted-foreground",
  warning: "text-warning-soft-foreground",
  destructive: "text-destructive-soft-foreground",
  success: "text-success-soft-foreground",
} as const;

export function CustomerCreditsTab({ customerId }: { customerId: ID }) {
  const currency = useCurrency();
  const { hasPermission } = useAuth();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  const { data, isLoading, isFetching, error } = useCustomerCredits(customerId, { page, limit });

  if (error) {
    return (
      <Alert variant="destructive" title="Could not load credits">
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

  const credits = data?.items ?? [];

  if (credits.length === 0) {
    return (
      <Card>
        <CardContent className="p-5 sm:p-6">
          <EmptyState
            size="sm"
            icon={<CreditCard />}
            title="No credits yet"
            description="Nothing has been sold to this customer on credit."
            action={
              hasPermission("credit:write") ? (
                <Link
                  href={`/credits/new?customerId=${customerId}`}
                  className={buttonVariants({ size: "sm" })}
                >
                  New credit
                </Link>
              ) : null
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <TableContainer className={cn(isFetching && "opacity-60 transition-opacity")}>
        <Table aria-label="Credit history">
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Status</TableHead>
              <TableHead align="right">Total</TableHead>
              <TableHead align="right">Remaining</TableHead>
              <TableHead>Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {credits.map((credit) => {
              const style = CREDIT_STATUS_STYLES[credit.status];
              const due = formatDueDate(credit.dueDate);
              return (
                <TableRow key={credit.id}>
                  <TableCell>
                    <Link
                      href={`/credits/${credit.id}`}
                      className="text-foreground hover:text-primary focus-visible:ring-ring rounded-sm font-medium tabular-nums focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {credit.number}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      Issued {formatDate(credit.issuedDate)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge className={style.className} size="sm" dot>
                      {style.label}
                    </Badge>
                  </TableCell>
                  <TableCell numeric>{currency.format(credit.grandTotal)}</TableCell>
                  <TableCell numeric className="font-medium">
                    {currency.format(credit.remainingAmount)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "text-sm",
                        credit.status === "PAID"
                          ? DUE_TONE.success
                          : DUE_TONE[due.tone],
                      )}
                    >
                      {credit.status === "PAID" ? "Settled" : due.label}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
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
