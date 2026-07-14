import { forwardRef } from "react";

import { cn } from "@/lib/utils";

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Renders the required marker. Also set `required` on the control itself. */
  required?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { className, required, children, ...props },
  ref,
) {
  return (
    <label
      ref={ref}
      className={cn(
        "text-foreground text-sm leading-none font-medium",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <>
          {/* The asterisk is decorative — the control's own `required`/
              aria-required is what AT announces. Reading "asterisk" aloud is noise. */}
          <span aria-hidden="true" className="text-destructive-soft-foreground ml-0.5">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      ) : null}
    </label>
  );
});
