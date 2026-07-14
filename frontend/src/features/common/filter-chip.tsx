"use client";

/**
 * A toggle chip — the multi-select, without the popover.
 *
 * A status filter with four options does not need a listbox: four chips are one
 * tab stop each, work with a screen reader out of the box (`aria-pressed` is
 * announced as "pressed"), and on a 375px phone they are a thumb-sized target
 * instead of an OS dropdown that covers the results you are filtering.
 */

import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface FilterChipProps {
  active: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Tint applied when active — usually a status's soft token pair. */
  activeClassName?: string;
  className?: string;
}

export function FilterChip({
  active,
  onToggle,
  children,
  activeClassName,
  className,
}: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
        "focus-visible:ring-ring focus-visible:ring-offset-background transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
        active
          ? (activeClassName ?? "bg-primary-soft text-primary-soft-foreground border-transparent")
          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/25 bg-transparent",
        className,
      )}
    >
      {active ? <Check className="size-3" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
