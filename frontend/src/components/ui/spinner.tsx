import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

const spinnerVariants = cva("animate-spin text-current", {
  variants: {
    size: {
      xs: "size-3",
      sm: "size-4",
      md: "size-5",
      lg: "size-6",
      xl: "size-8",
    },
  },
  defaultVariants: { size: "md" },
});

export interface SpinnerProps
  extends React.SVGProps<SVGSVGElement>, VariantProps<typeof spinnerVariants> {
  /** Announced to screen readers. Pass "" and set aria-hidden when decorative. */
  label?: string;
}

/**
 * An SVG, not a bordered div: a border-based spinner cannot be centred reliably
 * inside a button at every size and it inherits the wrong colour on `outline`.
 * `currentColor` means it is always the right colour, everywhere.
 */
export const Spinner = forwardRef<SVGSVGElement, SpinnerProps>(function Spinner(
  { className, size, label = "Loading", ...props },
  ref,
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? "status" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={cn(spinnerVariants({ size }), className)}
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
});

export { spinnerVariants };
