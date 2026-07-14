import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Styled table primitives for TanStack Table (which is headless and ships no
 * markup). These are plain semantic elements — <table>/<thead>/<th scope> — not
 * divs with ARIA grid roles. A real table gets row/column navigation from screen
 * readers for free; an ARIA reimplementation gets it only if you are perfect.
 *
 * The horizontal scroll lives on a wrapper with `overflow-x-auto` and
 * `tabIndex={0}`, because a scrollable region that cannot be reached by keyboard
 * is a WCAG 2.1.1 failure.
 */

export const TableContainer = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function TableContainer({ className, children, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "border-border bg-card w-full overflow-hidden rounded-lg border",
          className,
        )}
        {...props}
      >
        <div
          className="focus-visible:ring-ring w-full overflow-x-auto focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
          tabIndex={0}
          role="region"
          aria-label="Table, scrollable"
        >
          {children}
        </div>
      </div>
    );
  },
);

export const Table = forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
  function Table({ className, ...props }, ref) {
    return (
      <table
        ref={ref}
        className={cn("w-full caption-bottom border-collapse text-sm", className)}
        {...props}
      />
    );
  },
);

export const TableHeader = forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableHeader({ className, ...props }, ref) {
  return <thead ref={ref} className={cn("bg-muted/50", className)} {...props} />;
});

export const TableBody = forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableBody({ className, ...props }, ref) {
  return <tbody ref={ref} className={cn("divide-border divide-y", className)} {...props} />;
});

export const TableFooter = forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableFooter({ className, ...props }, ref) {
  return (
    <tfoot
      ref={ref}
      className={cn("border-border bg-muted/50 border-t font-medium", className)}
      {...props}
    />
  );
});

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean;
  /** Adds hover styling + a pointer. The row must ALSO be keyboard reachable. */
  clickable?: boolean;
}

export const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(function TableRow(
  { className, selected, clickable, ...props },
  ref,
) {
  return (
    <tr
      ref={ref}
      // aria-selected is only meaningful in a grid/listbox; on a plain table it is
      // data-state that drives the styling and the checkbox that carries meaning.
      data-state={selected ? "selected" : undefined}
      className={cn(
        "transition-colors",
        selected ? "bg-primary-soft/50" : "hover:bg-muted/50",
        clickable && "cursor-pointer",
        className,
      )}
      {...props}
    />
  );
});

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Renders a sort control. `false` = not sortable. */
  sortable?: boolean;
  sortDirection?: "asc" | "desc" | false;
  onSort?: () => void;
  align?: "left" | "center" | "right";
}

export const TableHead = forwardRef<HTMLTableCellElement, TableHeadProps>(function TableHead(
  { className, sortable, sortDirection = false, onSort, align = "left", children, ...props },
  ref,
) {
  const alignClass =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

  return (
    <th
      ref={ref}
      // `scope="col"` is what lets a screen reader say "Amount, 1,250" instead of
      // just "1,250" as it moves across a row.
      scope="col"
      // aria-sort must live on the header cell, not the button inside it.
      aria-sort={
        sortable
          ? sortDirection === "asc"
            ? "ascending"
            : sortDirection === "desc"
              ? "descending"
              : "none"
          : undefined
      }
      className={cn(
        "text-muted-foreground h-11 px-4 align-middle text-xs font-medium tracking-wide uppercase",
        alignClass,
        className,
      )}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            "hover:text-foreground inline-flex items-center gap-1.5 rounded-sm transition-colors",
            "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
            align === "right" && "flex-row-reverse",
          )}
        >
          {children}
          {sortDirection === "asc" ? (
            <ArrowUp className="size-3.5" aria-hidden="true" />
          ) : sortDirection === "desc" ? (
            <ArrowDown className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronsUpDown className="size-3.5 opacity-50" aria-hidden="true" />
          )}
        </button>
      ) : (
        children
      )}
    </th>
  );
});

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  align?: "left" | "center" | "right";
  /** Money/counts: tabular figures so the decimal points line up. */
  numeric?: boolean;
}

export const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(function TableCell(
  { className, align = "left", numeric, ...props },
  ref,
) {
  const alignClass =
    align === "right" || numeric
      ? "text-right"
      : align === "center"
        ? "text-center"
        : "text-left";

  return (
    <td
      ref={ref}
      className={cn(
        "text-foreground px-4 py-3 align-middle text-sm",
        alignClass,
        numeric && "tabular",
        className,
      )}
      {...props}
    />
  );
});

export const TableCaption = forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(function TableCaption({ className, ...props }, ref) {
  return (
    <caption
      ref={ref}
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  );
});
