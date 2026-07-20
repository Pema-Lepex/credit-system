"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { MoreHorizontal, Paperclip, Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";

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
} from "@/components/ui";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import type { ExpenseRow, ExpenseSortField } from "@/features/expenses/queries";
import { useAuth } from "@/lib/auth/AuthProvider";
import { PAYMENT_METHOD_LABELS, cn, formatDate } from "@/lib/utils";

export interface ExpensesTableProps {
  expenses: ExpenseRow[];
  sortField: ExpenseSortField;
  sortDesc: boolean;
  onSortChange: (field: ExpenseSortField, desc: boolean) => void;
  onEdit: (expense: ExpenseRow) => void;
  onDelete: (expense: ExpenseRow) => void;
  isFetching?: boolean;
}

const columnHelper = createColumnHelper<ExpenseRow>();

/** The category chip, tinted with the owner's own colour when they picked one. */
function CategoryChip({ expense }: { expense: ExpenseRow }) {
  if (!expense.category) {
    return <span className="text-muted-foreground text-sm">Uncategorised</span>;
  }
  const color = expense.category.color;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        // A user-chosen hex has no Tailwind class, so it has to be inline.
        style={{ backgroundColor: color ?? "var(--muted-foreground)" }}
      />
      <span className="truncate">{expense.category.name}</span>
    </span>
  );
}

/**
 * The expense list. Sorting and paging are the server's
 * (`manualSorting`/`manualPagination`); the sort state lives in the URL.
 */
export function ExpensesTable({
  expenses,
  sortField,
  sortDesc,
  onSortChange,
  onEdit,
  onDelete,
  isFetching,
}: ExpensesTableProps) {
  const money = useMoney();
  const { hasPermission } = useAuth();

  const canEdit = hasPermission("expense:write");
  const canDelete = hasPermission("expense:delete");

  const sorting = useMemo<SortingState>(
    () => [{ id: sortField, desc: sortDesc }],
    [sortField, sortDesc],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor("expenseDate", {
        id: "expense_date",
        header: "Date",
        enableSorting: true,
        cell: (info) => <span className="tabular">{formatDate(info.getValue())}</span>,
      }),
      columnHelper.display({
        id: "category",
        header: "Category",
        cell: (info) => <CategoryChip expense={info.row.original} />,
      }),
      columnHelper.accessor((row) => row.vendorName ?? "", {
        id: "vendor_name",
        header: "Paid to",
        enableSorting: true,
        cell: (info) => (
          <span className="block max-w-40 truncate">{info.getValue() || "—"}</span>
        ),
      }),
      columnHelper.accessor("amount", {
        id: "amount",
        header: "Amount",
        enableSorting: true,
        cell: (info) => <span className="font-medium">{money.format(info.getValue())}</span>,
      }),
      columnHelper.accessor("paymentMethod", {
        id: "method",
        header: "Method",
        enableSorting: false,
        cell: (info) => (
          <span className="text-muted-foreground">{PAYMENT_METHOD_LABELS[info.getValue()]}</span>
        ),
      }),
      columnHelper.display({
        id: "receipt",
        header: "Receipt",
        cell: (info) =>
          info.row.original.receiptUrl ? (
            <a
              href={info.row.original.receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm text-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              <Paperclip aria-hidden="true" className="size-3.5" />
              View
            </a>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
      }),
      columnHelper.display({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: (info) => {
          const expense = info.row.original;
          // A generated expense cannot be edited -- the server refuses it. Hiding
          // the action is the honest thing to do; offering it and then showing an
          // error would be worse.
          const showEdit = canEdit && !expense.isGenerated;
          if (!showEdit && !canDelete) return null;

          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Actions for the ${money.format(expense.amount)} expense on ${formatDate(expense.expenseDate)}`}
                className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <MoreHorizontal aria-hidden="true" className="size-4" />
              </DropdownMenuTrigger>

              <DropdownMenuContent>
                {showEdit ? (
                  <DropdownMenuItem icon={<Pencil />} onSelect={() => onEdit(expense)}>
                    Edit expense
                  </DropdownMenuItem>
                ) : null}

                {canDelete ? (
                  <DropdownMenuItem
                    icon={<Trash2 />}
                    destructive
                    onSelect={() => onDelete(expense)}
                  >
                    Delete expense
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      }),
    ],
    [canEdit, canDelete, money, onEdit, onDelete],
  );

  const table = useReactTable({
    data: expenses,
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
                                header.column.id as ExpenseSortField,
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

      {/* ---------------------------------------------------------------- mobile */}
      <ul className="space-y-3 md:hidden">
        {expenses.map((expense) => (
          <li
            key={expense.id}
            className="border-border bg-card rounded-lg border p-4 shadow-xs"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-foreground truncate font-medium">
                  {expense.vendorName ?? "—"}
                </p>
                <p className="text-muted-foreground truncate text-xs tabular">
                  {formatDate(expense.expenseDate)}
                </p>
              </div>

              <p className="tabular text-foreground shrink-0 font-semibold">
                {money.format(expense.amount)}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge size="sm" variant="neutral">
                {PAYMENT_METHOD_LABELS[expense.paymentMethod]}
              </Badge>
              {expense.isGenerated ? (
                <Badge size="sm" variant="neutral">
                  Automatic
                </Badge>
              ) : null}
              <span className="text-muted-foreground text-xs">
                <CategoryChip expense={expense} />
              </span>
              {expense.receiptUrl ? (
                <a
                  href={expense.receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary inline-flex items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
                >
                  <Paperclip aria-hidden="true" className="size-3" />
                  Receipt
                </a>
              ) : null}
            </div>

            {expense.notes ? (
              <p className="text-muted-foreground mt-3 line-clamp-2 text-xs">{expense.notes}</p>
            ) : null}

            {(canEdit && !expense.isGenerated) || canDelete ? (
              <div className="mt-3 flex gap-3">
                {canEdit && !expense.isGenerated ? (
                  <button
                    type="button"
                    onClick={() => onEdit(expense)}
                    className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Pencil aria-hidden="true" className="size-3.5" />
                    Edit
                  </button>
                ) : null}

                {canDelete ? (
                  <button
                    type="button"
                    onClick={() => onDelete(expense)}
                    className="text-destructive-soft-foreground focus-visible:ring-ring ml-auto inline-flex items-center gap-1.5 rounded-md text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                    Delete
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
