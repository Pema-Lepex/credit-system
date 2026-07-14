"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { Ban, Download, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@/components/ui";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import { parseApiError } from "@/features/credits/lib/errors";
import { downloadReceiptPdf } from "@/features/credits/lib/rest";
import type { PaymentRow, PaymentSortField } from "@/features/payments/queries";
import { useAuth } from "@/lib/auth/AuthProvider";
import { PAYMENT_METHOD_LABELS, cn, formatDate } from "@/lib/utils";

export interface PaymentsTableProps {
  payments: PaymentRow[];
  sortField: PaymentSortField;
  sortDesc: boolean;
  onSortChange: (field: PaymentSortField, desc: boolean) => void;
  onVoid: (payment: PaymentRow) => void;
  isFetching?: boolean;
}

const columnHelper = createColumnHelper<PaymentRow>();

/**
 * The ledger.
 *
 * A voided row is STRUCK THROUGH, not hidden — including here, in the flat list.
 * The whole point of an append-only ledger is that you can see the reversal; a
 * ledger that quietly drops what it reversed is just a ledger you cannot audit.
 *
 * Sorting and paging are the server's (`manualSorting`/`manualPagination`); the sort
 * state lives in the URL.
 */
export function PaymentsTable({
  payments,
  sortField,
  sortDesc,
  onSortChange,
  onVoid,
  isFetching,
}: PaymentsTableProps) {
  const money = useMoney();
  const { hasPermission } = useAuth();
  const [downloading, setDownloading] = useState<string | null>(null);

  const canVoid = hasPermission("payment:delete");

  const sorting = useMemo<SortingState>(
    () => [{ id: sortField, desc: sortDesc }],
    [sortField, sortDesc],
  );

  const download = async (payment: PaymentRow) => {
    setDownloading(payment.id);
    try {
      await downloadReceiptPdf(payment.id, payment.number);
    } catch (error) {
      toast.error("Could not download the receipt", {
        description: parseApiError(error).message,
      });
    } finally {
      setDownloading(null);
    }
  };

  const columns = useMemo(
    () => [
      columnHelper.accessor("number", {
        id: "number",
        header: "Receipt",
        enableSorting: true,
        cell: (info) => (
          <span
            className={cn(
              "tabular font-medium",
              info.row.original.isVoid && "text-muted-foreground line-through",
            )}
          >
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor((row) => row.customerName ?? "", {
        id: "customer",
        header: "Customer",
        enableSorting: false,
        cell: (info) => (
          <span className="block max-w-40 truncate">{info.getValue() || "—"}</span>
        ),
      }),
      columnHelper.accessor((row) => row.creditNumber ?? "", {
        id: "credit",
        header: "Credit",
        enableSorting: false,
        cell: (info) => (
          <Link
            href={`/credits/${info.row.original.creditId}`}
            className="text-foreground hover:text-primary focus-visible:ring-ring rounded-sm tabular focus-visible:ring-2 focus-visible:outline-none"
          >
            {info.getValue() || "View"}
          </Link>
        ),
      }),
      columnHelper.accessor("amount", {
        id: "amount",
        header: "Amount",
        enableSorting: true,
        cell: (info) => (
          <span
            className={cn(
              "font-medium",
              info.row.original.isVoid && "text-muted-foreground line-through decoration-2",
            )}
          >
            {money.format(info.getValue())}
          </span>
        ),
      }),
      columnHelper.accessor("method", {
        id: "method",
        header: "Method",
        enableSorting: false,
        cell: (info) => (
          <span className="text-muted-foreground">
            {PAYMENT_METHOD_LABELS[info.getValue()]}
          </span>
        ),
      }),
      columnHelper.accessor("paidAt", {
        id: "paid_at",
        header: "Paid",
        enableSorting: true,
        cell: (info) => <span className="tabular">{formatDate(info.getValue())}</span>,
      }),
      columnHelper.display({
        id: "state",
        header: "State",
        cell: (info) =>
          info.row.original.isVoid ? (
            <Badge size="sm" variant="destructive">
              Voided
            </Badge>
          ) : (
            <Badge size="sm" variant="success">
              Cleared
            </Badge>
          ),
      }),
      columnHelper.display({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: (info) => {
          const payment = info.row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Actions for payment ${payment.number}`}
                className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <MoreHorizontal aria-hidden="true" className="size-4" />
              </DropdownMenuTrigger>

              <DropdownMenuContent>
                <DropdownMenuItem
                  icon={<Download />}
                  disabled={downloading === payment.id}
                  onSelect={() => void download(payment)}
                >
                  Download receipt
                </DropdownMenuItem>

                {canVoid && !payment.isVoid ? (
                  <DropdownMenuItem icon={<Ban />} destructive onSelect={() => onVoid(payment)}>
                    Void payment
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      }),
    ],
    [canVoid, downloading, money, onVoid],
  );

  const table = useReactTable({
    data: payments,
    columns,
    state: { sorting },
    manualSorting: true,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const NUMERIC = new Set(["amount"]);

  return (
    <div className={cn("transition-opacity", isFetching && "opacity-60")}>
      <TableContainer className="hidden md:block">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const isSorted = sortField === header.column.id;

                  return (
                    <TableHead
                      key={header.id}
                      align={NUMERIC.has(header.column.id) ? "right" : "left"}
                      sortable={canSort}
                      sortDirection={isSorted ? (sortDesc ? "desc" : "asc") : false}
                      onSort={
                        canSort
                          ? () =>
                              onSortChange(
                                header.column.id as PaymentSortField,
                                isSorted ? !sortDesc : true,
                              )
                          : undefined
                      }
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} className={cn(row.original.isVoid && "opacity-75")}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    numeric={NUMERIC.has(cell.column.id)}
                    className={cell.column.id === "actions" ? "w-px text-right" : undefined}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* ---------------------------------------------------------------- mobile */}
      <ul className="space-y-3 md:hidden">
        {payments.map((payment) => (
          <li
            key={payment.id}
            className={cn(
              "border-border bg-card rounded-lg border p-4 shadow-xs",
              payment.isVoid && "opacity-75",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-foreground truncate font-medium">
                  {payment.customerName ?? "—"}
                </p>
                <p className="text-muted-foreground truncate text-xs tabular">
                  {payment.number} · {formatDate(payment.paidAt)}
                </p>
              </div>

              <p
                className={cn(
                  "tabular shrink-0 font-semibold",
                  payment.isVoid
                    ? "text-muted-foreground line-through decoration-2"
                    : "text-foreground",
                )}
              >
                {money.format(payment.amount)}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge size="sm" variant={payment.isVoid ? "destructive" : "success"}>
                {payment.isVoid ? "Voided" : "Cleared"}
              </Badge>
              <Badge size="sm" variant="neutral">
                {PAYMENT_METHOD_LABELS[payment.method]}
              </Badge>
              {payment.creditNumber ? (
                <Link
                  href={`/credits/${payment.creditId}`}
                  className="text-primary text-xs font-medium tabular underline-offset-4 hover:underline"
                >
                  {payment.creditNumber}
                </Link>
              ) : null}
            </div>

            {payment.isVoid && payment.voidReason ? (
              <p className="text-destructive-soft-foreground border-destructive-soft-foreground/30 mt-3 border-l-2 pl-3 text-xs">
                Voided — {payment.voidReason}
              </p>
            ) : null}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={downloading === payment.id}
                onClick={() => void download(payment)}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
              >
                <Download aria-hidden="true" className="size-3.5" />
                Receipt
              </button>

              {canVoid && !payment.isVoid ? (
                <button
                  type="button"
                  onClick={() => onVoid(payment)}
                  className="text-destructive-soft-foreground focus-visible:ring-ring ml-auto inline-flex items-center gap-1.5 rounded-md text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
                >
                  <Ban aria-hidden="true" className="size-3.5" />
                  Void
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
