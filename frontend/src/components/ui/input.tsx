import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

export const fieldBaseVariants = cva(
  [
    "w-full rounded-md border bg-background text-foreground",
    "placeholder:text-muted-foreground/70",
    "transition-[border-color,box-shadow] duration-150",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:border-ring",
    "disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-muted",
    "read-only:bg-muted/50",
  ],
  {
    variants: {
      invalid: {
        // Colour is never the only signal: aria-invalid drives this AND the
        // error text is wired via aria-describedby. WCAG 1.4.1.
        true: "border-destructive focus-visible:ring-destructive",
        false: "border-input",
      },
      inputSize: {
        sm: "h-8 px-2.5 text-xs",
        md: "h-9 px-3 text-sm",
        lg: "h-11 px-4 text-sm",
      },
    },
    defaultVariants: { invalid: false, inputSize: "md" },
  },
);

export interface InputProps
  extends
    Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof fieldBaseVariants> {
  /** Rendered inside the field, left of the text. Decorative — label separately. */
  leftAddon?: React.ReactNode;
  rightAddon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = "text", invalid, inputSize, leftAddon, rightAddon, ...props },
  ref,
) {
  const isInvalid = Boolean(invalid) || props["aria-invalid"] === true;

  const input = (
    <input
      ref={ref}
      type={type}
      aria-invalid={isInvalid || undefined}
      className={cn(
        fieldBaseVariants({ invalid: isInvalid, inputSize }),
        leftAddon && "pl-9",
        rightAddon && "pr-9",
        className,
      )}
      {...props}
    />
  );

  if (!leftAddon && !rightAddon) return input;

  return (
    <div className="relative w-full">
      {leftAddon ? (
        <span
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 flex -translate-y-1/2 items-center [&_svg]:size-4"
        >
          {leftAddon}
        </span>
      ) : null}
      {input}
      {rightAddon ? (
        <span className="text-muted-foreground absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center [&_svg]:size-4">
          {rightAddon}
        </span>
      ) : null}
    </div>
  );
});
