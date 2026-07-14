"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import Link from "next/link";
import { useMemo } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { CreditRowActions } from "@/features/credits/components/credit-row-actions";
import { CreditStatusBadge, DueDateBadge } from "@/features/credits/components/status-badges";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import type { CreditListRow, CreditSortField } from "@/features/credits/queries";
import { cn, formatDate } from "@/lib/utils";

export interface CreditsTableProps {
  credits: CreditListRow[];
  sortField: CreditSortField;
  sortDesc: boolean;
  onSortChange: (field: CreditSortField, desc: boolean) => void;
  onRecordPayment: (credit: CreditListRow) => void;
  onCancel: (credit: CreditListRow) => void;
  onDelete: (credit: CreditListRow) => void;
  isFetching?: boolean;
}

const columnHelper = createColumnHelper<CreditListRow>();

/**
 * The credit list.
 *
 * SORTING AND PAGING ARE THE SERVER'S. TanStack Table is used purely as a headless
 * column/row model — `manualSorting` and `manualPagination` are on, and the sort
 * state is pushed into the URL, which drives the query. Fetching every credit and
 * sorting in the browser would work for the demo and fall over on the first shop
 * with 5,000 rows; the backend has composite indexes for exactly these keys.
 *
 * RESPONSIVE: the table is a real <table> from `md` up, and a stack of cards below
 * it. A horizontally-scrolling 8-column table on a 375px phone is not a table, it
 * is a puzzle — and the phone is where a shopkeeper actually stands.
 */
export function CreditsTable({
  credits,
  sortField,
  sortDesc,
  onSortChange,
  onRecordPayment,
  onCancel,
  onDelete,
  isFetching,
}: CreditsTableProps) {
  const money = useMoney();

  const sorting = useMemo<SortingState>(
    () => [{ id: sortField, desc: sortDesc }],
    [sortField, sortDesc],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor("number", {
        id: "number",
        header: "Number",
        enableSorting: true,
        cell: (info) => (
          <Link
            href={`/credits/${info.row.original.id}`}
            className="text-foreground hover:text-primary focus-visible:ring-ring rounded-sm font-medium tabular focus-visible:ring-2 focus-visible:outline-none"
          >
            {info.getValue()}
          </Link>
        ),
      }),
      columnHelper.accessor((row) => row.customer?.name ?? "", {
        id: "customer",
        header: "Customer",
        enableSorting: false,
        cell: (info) => {
          const customer = info.row.original.customer;
          if (!customer) return <span className="text-muted-foreground">—</span>;
          return (
            <Link
              href={`/customers/${customer.id}`}
              className="text-foreground hover:text-primary focus-visible:ring-ring block max-w-40 truncate rounded-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              {customer.name}
            </Link>
          );
        },
      }),
      columnHelper.accessor("grandTotal", {
        id: "grand_total",
        header: "Total",
        enableSorting: true,
        cell: (info) => money.format(info.getValue()),
      }),
      columnHelper.accessor("amountPaid", {
        id: "amount_paid",
        header: "Paid",
        enableSorting: false,
        cell: (info) => (
          <span className="text-muted-foreground">{money.format(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("remainingAmount", {
        id: "remaining_amount",
        header: "Remaining",
        enableSorting: true,
        cell: (info) => (
          <span className="text-foreground font-medium">{money.format(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("dueDate", {
        id: "due_date",
        header: "Due",
        enableSorting: true,
        cell: (info) => (
          <div className="flex flex-col items-start gap-1">
            <span className="text-foreground tabular">{formatDate(info.getValue())}</span>
            <DueDateBadge
              dueDate={info.getValue()}
              status={info.row.original.status}
              size="sm"
            />
          </div>
        ),
      }),
      columnHelper.accessor("status", {
        id: "status",
        header: "Status",
        enableSorting: true,
        cell: (info) => <CreditStatusBadge status={info.getValue()} size="sm" />,
      }),
      columnHelper.display({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: (info) => (
          <CreditRowActions
            credit={info.row.original}
            onRecordPayment={onRecordPayment}
            onCancel={onCancel}
            onDelete={onDelete}
          />
        ),
      }),
    ],
    [money, onCancel, onDelete, onRecordPayment],
  );

  const table = useReactTable({
    data: credits,
    columns,
    state: { sorting },
    manualSorting: true,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      // Clicking an already-sorted column a third time clears it in TanStack; we
      // fall back to the default instead, because a list with no order at all is
      // just a list whose order you cannot predict.
      if (!first) {
        onSortChange("due_date", false);
        return;
      }
      onSortChange(first.id as CreditSortField, first.desc);
    },
  });

  const NUMERIC = new Set(["grand_total", "amount_paid", "remaining_amount"]);

  return (
    <div className={cn("transition-opacity", isFetching && "opacity-60")}>
      {/* ------------------------------------------------------------- desktop */}
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
                                header.column.id as CreditSortField,
                                isSorted ? !sortDesc : false,
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
              <TableRow key={row.id}>
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

      {/* -------------------------------------------------------------- mobile */}
      <ul className="space-y-3 md:hidden">
        {credits.map((credit) => (
          <li
            key={credit.id}
            className="border-border bg-card rounded-lg border p-4 shadow-xs"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <Link
                  href={`/credits/${credit.id}`}
                  className="text-foreground focus-visible:ring-ring block truncate rounded-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
                >
                  {credit.customer?.name ?? "Unknown customer"}
                </Link>
                <p className="text-muted-foreground truncate text-xs tabular">
                  {credit.number} · {formatDate(credit.dueDate)}
                </p>
              </div>

              <CreditRowActions
                credit={credit}
                onRecordPayment={onRecordPayment}
                onCancel={onCancel}
                onDelete={onDelete}
                className="-mt-1 -mr-1 shrink-0"
              />
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground text-xs">Total</dt>
                <dd className="text-foreground tabular">{money.format(credit.grandTotal)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Remaining</dt>
                <dd className="text-foreground tabular font-medium">
                  {money.format(credit.remainingAmount)}
                </dd>
              </div>
            </dl>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <CreditStatusBadge status={credit.status} size="sm" />
              <DueDateBadge dueDate={credit.dueDate} status={credit.status} size="sm" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
