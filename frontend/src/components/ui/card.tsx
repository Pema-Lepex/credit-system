import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

const cardVariants = cva("rounded-lg text-card-foreground", {
  variants: {
    variant: {
      // Default: hairline + a whisper of shadow. In dark mode the card is one
      // step lighter than the page, which is what actually reads as elevation.
      default: "border border-border bg-card shadow-xs",
      elevated: "border border-border bg-card shadow-md",
      /** Sparingly — overlays and hero surfaces only. */
      glass: "glass rounded-lg shadow-lg",
      ghost: "bg-transparent",
    },
    interactive: {
      true: "transition-[box-shadow,border-color,transform] duration-200 hover:shadow-md hover:border-foreground/15 focus-within:border-ring",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, variant, interactive, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, interactive }), className)}
      {...props}
    />
  );
});

export const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return (
      <div ref={ref} className={cn("flex flex-col gap-1.5 p-5 sm:p-6", className)} {...props} />
    );
  },
);

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level. Never skip levels — the page owns h1, cards usually take h3. */
  as?: "h2" | "h3" | "h4";
}

export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(function CardTitle(
  { className, as: Tag = "h3", ...props },
  ref,
) {
  return (
    <Tag
      ref={ref}
      className={cn("text-base leading-tight font-semibold tracking-tight", className)}
      {...props}
    />
  );
});

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return (
    <p
      ref={ref}
      className={cn("text-muted-foreground text-sm leading-relaxed", className)}
      {...props}
    />
  );
});

export const CardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn("p-5 pt-0 sm:p-6 sm:pt-0", className)} {...props} />;
  },
);

export const CardFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "border-border flex flex-wrap items-center gap-3 border-t p-5 sm:px-6 sm:py-4",
          className,
        )}
        {...props}
      />
    );
  },
);

export { cardVariants };
