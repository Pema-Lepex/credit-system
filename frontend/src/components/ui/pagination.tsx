"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn, formatNumber } from "@/lib/utils";

export interface PaginationProps {
  /** 1-based. */
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  isLoading?: boolean;
  className?: string;
}

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100] as const;
const DOTS = "…" as const;

/**
 * Windowed page list: 1 … 4 5 [6] 7 8 … 20. Never renders 200 buttons — the spec
 * demands pagination on every large table precisely because the datasets get big.
 */
function pageRange(current: number, total: number, siblings = 1): Array<number | typeof DOTS> {
  // first + last + current + 2 siblings + 2 dots
  const maxSlots = siblings * 2 + 5;
  if (total <= maxSlots) return Array.from({ length: total }, (_, i) => i + 1);

  const left = Math.max(current - siblings, 1);
  const right = Math.min(current + siblings, total);
  const showLeftDots = left > 2;
  const showRightDots = right < total - 1;

  if (!showLeftDots && showRightDots) {
    const count = siblings * 2 + 3;
    return [...Array.from({ length: count }, (_, i) => i + 1), DOTS, total];
  }
  if (showLeftDots && !showRightDots) {
    const count = siblings * 2 + 3;
    return [1, DOTS, ...Array.from({ length: count }, (_, i) => total - count + 1 + i)];
  }
  return [
    1,
    DOTS,
    ...Array.from({ length: right - left + 1 }, (_, i) => left + i),
    DOTS,
    total,
  ];
}

export function Pagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  isLoading,
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);
  const pages = pageRange(page, totalPages);

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex flex-col-reverse items-center justify-between gap-4 sm:flex-row",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        {/* aria-live: the count changes as the user pages, and a sighted user sees
            it — a screen-reader user should hear it. "polite" so it waits its turn. */}
        <p aria-live="polite" className="text-muted-foreground tabular text-sm">
          {totalItems === 0 ? (
            "No results"
          ) : (
            <>
              <span className="text-foreground font-medium">{formatNumber(from)}</span>–
              <span className="text-foreground font-medium">{formatNumber(to)}</span> of{" "}
              <span className="text-foreground font-medium">{formatNumber(totalItems)}</span>
            </>
          )}
        </p>

        {onPageSizeChange ? (
          <>
            <label htmlFor="page-size" className="sr-only">
              Rows per page
            </label>
            <Select
              id="page-size"
              selectSize="sm"
              className="w-auto min-w-20"
              value={String(pageSize)}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              options={pageSizeOptions.map((n) => ({ value: String(n), label: `${n} / page` }))}
            />
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous page"
          disabled={page <= 1 || isLoading}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft />
        </Button>

        <ul className="flex items-center gap-1">
          {pages.map((p, i) =>
            p === DOTS ? (
              <li
                key={`dots-${i}`}
                aria-hidden="true"
                className="text-muted-foreground px-2 text-sm"
              >
                {DOTS}
              </li>
            ) : (
              <li key={p}>
                <Button
                  variant={p === page ? "primary" : "ghost"}
                  size="icon-sm"
                  aria-label={`Page ${p}`}
                  aria-current={p === page ? "page" : undefined}
                  disabled={isLoading}
                  onClick={() => onPageChange(p)}
                  className="tabular"
                >
                  {p}
                </Button>
              </li>
            ),
          )}
        </ul>

        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next page"
          disabled={page >= totalPages || isLoading}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
