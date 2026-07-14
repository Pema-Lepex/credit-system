"use client";

import { forwardRef } from "react";

import { cn } from "@/lib/utils";

export interface SwitchProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "value"
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Required unless an aria-labelledby/aria-label is supplied by the caller. */
  label?: string;
  size?: "sm" | "md";
}

/**
 * role="switch" + aria-checked, on a real <button>.
 *
 * A checkbox with a slider skin would announce as "checkbox, checked" — which is
 * wrong: a switch is an *immediate* on/off, a checkbox is a deferred selection
 * you submit. Screen-reader users navigate by role, so getting this wrong sends
 * them looking for a Save button that doesn't exist. The button gives us
 * Space/Enter activation for free.
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { className, checked, onCheckedChange, label, disabled, size = "md", ...props },
  ref,
) {
  const dims =
    size === "sm"
      ? { track: "h-5 w-9", thumb: "size-4", travel: "translate-x-4" }
      : { track: "h-6 w-11", thumb: "size-5", travel: "translate-x-5" };

  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent",
        "transition-colors duration-200 ease-out",
        "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
        dims.track,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "bg-background pointer-events-none inline-block rounded-full shadow-sm ring-0",
          "transition-transform duration-200 ease-out",
          dims.thumb,
          checked ? dims.travel : "translate-x-0",
        )}
      />
    </button>
  );
});
