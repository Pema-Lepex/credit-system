"use client";

import { useTheme } from "next-themes";
import { Toaster as SonnerToaster, toast } from "sonner";

/**
 * Toasts via `sonner`, themed with our tokens.
 *
 * Sonner renders into an aria-live region and manages focus correctly (Alt+T
 * focuses the toast stack), which is the reason to use it rather than hand-roll:
 * announcing a transient message without stealing focus is genuinely fiddly.
 *
 * `closeButton` is on because auto-dismiss alone fails WCAG 2.2.1 (Timing
 * Adjustable) for anyone who reads slowly.
 */
export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <SonnerToaster
      theme={(resolvedTheme as "light" | "dark" | undefined) ?? "system"}
      position="bottom-right"
      closeButton
      richColors={false}
      duration={5000}
      // Sonner's default is a bottom-right stack that overlaps the mobile safe
      // area; offset it and let the toastOptions carry our tokens.
      offset={16}
      toastOptions={{
        classNames: {
          toast:
            "group rounded-lg border border-border bg-popover text-popover-foreground shadow-lg",
          title: "text-sm font-medium",
          description: "text-sm text-muted-foreground",
          actionButton:
            "rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground",
          cancelButton:
            "rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground",
          closeButton: "border-border bg-popover text-muted-foreground hover:text-foreground",
          success: "[&_[data-icon]]:text-success-soft-foreground",
          error: "[&_[data-icon]]:text-destructive-soft-foreground",
          warning: "[&_[data-icon]]:text-warning-soft-foreground",
          info: "[&_[data-icon]]:text-info-soft-foreground",
        },
      }}
    />
  );
}

/** Re-exported so features import from one place, never from `sonner` directly. */
export { toast };
