"use client";

/**
 * The one table renderer, shared by customers / products / services.
 *
 * TanStack Table is headless, and everything it does here is MANUAL: the server
 * paginates and sorts, so `manualPagination` and `manualSorting` are on and the
 * table never reorders or slices rows itself. Its job is column definitions,
 * header rendering and the sort-state machine — nothing else.
 *
 * RESPONSIVE: a nine-column table at 375px is a horizontal-scroll nightmare, so
 * below `md` the same rows render through `renderCard`. Same data, same actions,
 * one source of truth — not a second component that drifts.
 */

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
} from "@tanstack/react-table";
import type { ReactNode } from "react";

import {
  Pagination,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { cn } from "@/lib/utils";

export interface DataTableProps<TRow> {
  data: TRow[];
  columns: ColumnDef<TRow, unknown>[];
  /** Server-side sort state, mirrored from the URL. */
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  getRowId: (row: TRow) => string;

  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;

  isLoading: boolean;
  isFetching?: boolean;
  /** Shown when the query succeeded but matched nothing. */
  emptyState: ReactNode;
  /** Mobile row. Omit to keep the table (with horizontal scroll) at every width. */
  renderCard?: (row: TRow) => ReactNode;
  onRowClick?: (row: TRow) => void;
  /** Screen-reader name for the <table>. */
  label: string;
}

export function DataTable<TRow>({
  data,
  columns,
  sorting,
  onSortingChange,
  getRowId,
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  isLoading,
  isFetching,
  emptyState,
  renderCard,
  onRowClick,
  label,
}: DataTableProps<TRow>) {
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    enableSortingRemoval: false,
    pageCount: Math.max(1, Math.ceil(totalItems / pageSize)),
  });

  if (isLoading) {
    return (
      <div className="border-border bg-card rounded-lg border p-4">
        <SkeletonTable rows={6} columns={Math.min(columns.length, 6)} />
      </div>
    );
  }

  if (data.length === 0) return <>{emptyState}</>;

  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------- mobile */}
      {renderCard ? (
        <ul
          className={cn(
            "grid gap-3 md:hidden",
            isFetching && "pointer-events-none opacity-60 transition-opacity",
          )}
          aria-label={label}
        >
          {rows.map((row) => (
            <li key={row.id}>{renderCard(row.original)}</li>
          ))}
        </ul>
      ) : null}

      {/* --------------------------------------------------------- desktop */}
      <TableContainer
        className={cn(
          renderCard && "hidden md:block",
          isFetching && "opacity-60 transition-opacity",
        )}
      >
        <Table aria-label={label} aria-busy={isFetching || undefined}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const meta = header.column.columnDef.meta as
                    | { align?: "left" | "center" | "right"; headerClassName?: string }
                    | undefined;
                  return (
                    <TableHead
                      key={header.id}
                      align={meta?.align}
                      className={meta?.headerClassName}
                      sortable={canSort}
                      sortDirection={header.column.getIsSorted()}
                      // Not getToggleSortingHandler(): that wants the event, and
                      // TableHead's onSort is a bare callback.
                      onSort={canSort ? () => header.column.toggleSorting() : undefined}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                clickable={Boolean(onRowClick)}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as
                    | { align?: "left" | "center" | "right"; numeric?: boolean }
                    | undefined;
                  return (
                    <TableCell key={cell.id} align={meta?.align} numeric={meta?.numeric}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Pagination
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        isLoading={isFetching}
      />
    </div>
  );
}

/**
 * Stops a row-action click from also triggering the row's own onClick — the
 * "I pressed Delete and it navigated to the detail page" bug.
 */
export function stopRowClick(event: React.MouseEvent): void {
  event.stopPropagation();
}
