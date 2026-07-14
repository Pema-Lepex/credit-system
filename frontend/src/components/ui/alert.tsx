import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

const alertVariants = cva("relative flex gap-3 rounded-lg border p-4", {
  variants: {
    variant: {
      neutral: "border-border bg-muted/50 text-foreground",
      info: "border-transparent bg-info-soft text-info-soft-foreground",
      success: "border-transparent bg-success-soft text-success-soft-foreground",
      warning: "border-transparent bg-warning-soft text-warning-soft-foreground",
      destructive: "border-transparent bg-destructive-soft text-destructive-soft-foreground",
    },
  },
  defaultVariants: { variant: "neutral" },
});

const ICONS = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: XCircle,
} as const;

export interface AlertProps
  // `title` on a div is the browser tooltip attribute (string). Ours is a heading
  // node, so the DOM prop has to be omitted before we redeclare it.
  extends
    Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof alertVariants> {
  title?: React.ReactNode;
  /** Pass `false` to drop the icon, or a node to override it. */
  icon?: React.ReactNode | false;
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { className, variant = "neutral", title, icon, children, ...props },
  ref,
) {
  const Icon = ICONS[variant ?? "neutral"];

  return (
    <div
      ref={ref}
      /**
       * role="alert" implies aria-live="assertive", which interrupts whatever the
       * screen reader is saying. That is right for an error the user just caused,
       * and wrong for an informational banner that was there on page load — so
       * only the destructive/warning tones claim it.
       */
      role={variant === "destructive" || variant === "warning" ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {icon === false ? null : (
        <span className="mt-0.5 shrink-0" aria-hidden="true">
          {icon ?? <Icon className="size-4" />}
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="text-sm leading-tight font-semibold">{title}</p> : null}
        {children ? (
          <div className="text-sm leading-relaxed [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
});

export { alertVariants };
