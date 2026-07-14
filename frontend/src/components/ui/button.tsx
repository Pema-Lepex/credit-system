import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * The focus ring is baked into the base classes, not left to the global
 * :focus-visible rule, because buttons sit on coloured fills where a
 * `ring-offset-background` is needed to keep the ring readable (WCAG 2.4.7 +
 * 1.4.11 non-text contrast).
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium",
    "rounded-md select-none",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:translate-y-px",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-muted border border-border",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-muted hover:text-foreground",
        ghost: "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:opacity-90",
        success: "bg-success text-success-foreground shadow-xs hover:opacity-90",
        link: "bg-transparent text-primary underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        // 32px — dense toolbars only. Below this, touch targets fail 2.5.5.
        sm: "h-8 px-3 text-xs [&_svg]:size-3.5",
        md: "h-9 px-4 text-sm [&_svg]:size-4",
        lg: "h-11 px-6 text-sm [&_svg]:size-4",
        // Icon-only buttons MUST carry an aria-label — see the prop docs below.
        icon: "size-9 p-0 [&_svg]:size-4",
        "icon-sm": "size-8 p-0 [&_svg]:size-3.5",
      },
      fullWidth: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Swaps the leading icon for a spinner and disables the button. */
  isLoading?: boolean;
  /** Announced while loading. Defaults to "Loading". */
  loadingText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    fullWidth,
    isLoading = false,
    loadingText,
    leftIcon,
    rightIcon,
    disabled,
    children,
    type = "button",
    ...props
  },
  ref,
) {
  const isDisabled = disabled || isLoading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      // aria-busy tells AT the control is working; aria-disabled keeps it
      // discoverable while `disabled` keeps it un-clickable.
      aria-busy={isLoading || undefined}
      aria-disabled={isDisabled || undefined}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...props}
    >
      {isLoading ? (
        <Spinner size={size === "sm" || size === "icon-sm" ? "xs" : "sm"} label="" />
      ) : (
        leftIcon
      )}
      {isLoading && loadingText ? loadingText : children}
      {!isLoading && rightIcon}
      {isLoading && !loadingText ? <span className="sr-only">Loading</span> : null}
    </button>
  );
});

export { buttonVariants };
