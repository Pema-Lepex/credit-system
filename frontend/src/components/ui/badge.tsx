import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Every tone uses a *soft* token pair. The solid --destructive as a background
 * with white text is fine on a button, but a page full of saturated chips is the
 * Bootstrap look we are explicitly avoiding — and the soft pairs are the ones
 * whose foregrounds clear 4.5:1 against the page as well as the tint.
 */
const badgeVariants = cva(
  [
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-transparent",
    "font-medium leading-none tabular",
  ],
  {
    variants: {
      variant: {
        neutral: "bg-neutral-soft text-neutral-soft-foreground",
        primary: "bg-primary-soft text-primary-soft-foreground",
        success: "bg-success-soft text-success-soft-foreground",
        warning: "bg-warning-soft text-warning-soft-foreground",
        destructive: "bg-destructive-soft text-destructive-soft-foreground",
        info: "bg-info-soft text-info-soft-foreground",
        outline: "border-border bg-transparent text-foreground",
        solid: "bg-primary text-primary-foreground",
      },
      size: {
        sm: "px-2 py-0.5 text-[11px]",
        md: "px-2.5 py-1 text-xs",
      },
    },
    defaultVariants: { variant: "neutral", size: "md" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Adds a leading status dot. Purely decorative — the label carries the meaning. */
  dot?: boolean;
  dotClassName?: string;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant, size, dot, dotClassName, children, ...props },
  ref,
) {
  return (
    <span ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot ? (
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full bg-current", dotClassName)}
        />
      ) : null}
      {children}
    </span>
  );
});

export { badgeVariants };
