"use client";

import { Check, Minus } from "lucide-react";
import { forwardRef, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export interface CheckboxProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "size"
> {
  /** Tri-state, for "select all" headers with a partial selection. */
  indeterminate?: boolean;
}

/**
 * A real <input type="checkbox">, visually hidden and layered under a styled box.
 *
 * Why not a div with role="checkbox": the native input gives us form
 * participation, the space-key toggle, `:checked`, and correct AT announcements
 * for free — including `indeterminate`, which is a DOM property and cannot be
 * expressed in HTML at all. We only borrow its pixels.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, indeterminate = false, disabled, ...props },
  ref,
) {
  const innerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <span className={cn("relative inline-flex size-4 shrink-0", className)}>
      <input
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        type="checkbox"
        disabled={disabled}
        aria-checked={indeterminate ? "mixed" : undefined}
        className={cn(
          "peer border-input bg-background size-4 shrink-0 cursor-pointer appearance-none rounded-[5px] border",
          "transition-colors duration-150",
          "checked:border-primary checked:bg-primary",
          "indeterminate:border-primary indeterminate:bg-primary",
          "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        {...props}
      />
      {/* The glyph sits on top of the input and must never eat the click. */}
      <span
        aria-hidden="true"
        className="text-primary-foreground pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-100"
      >
        {indeterminate ? (
          <Minus className="size-3" strokeWidth={3} />
        ) : (
          <Check className="size-3" strokeWidth={3} />
        )}
      </span>
    </span>
  );
});
