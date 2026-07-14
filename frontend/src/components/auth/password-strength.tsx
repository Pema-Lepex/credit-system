"use client";

import { passwordStrength } from "@/lib/validation/auth";
import { cn } from "@/lib/utils";

const LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong"] as const;

const BARS = [
  "bg-destructive",
  "bg-destructive",
  "bg-warning",
  "bg-info",
  "bg-success",
] as const;

/**
 * Strength meter. The bars are decorative; the LABEL carries the meaning, and it
 * is in an aria-live region so a screen-reader user hears "Fair" as they type
 * rather than watching four coloured rectangles they cannot see.
 */
export function PasswordStrength({ value, className }: { value: string; className?: string }) {
  const score = passwordStrength(value);
  if (!value) return null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              i < score ? BARS[score] : "bg-muted",
            )}
          />
        ))}
      </div>
      <p aria-live="polite" className="text-muted-foreground text-xs">
        Password strength: <span className="text-foreground font-medium">{LABELS[score]}</span>
      </p>
    </div>
  );
}
