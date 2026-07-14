"use client";

import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState } from "react";

import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PasswordInputProps = Omit<InputProps, "type" | "rightAddon">;

/**
 * Password field with a reveal toggle.
 *
 * The toggle is a real <button> with aria-pressed, so AT announces "show
 * password, not pressed" rather than an unlabelled icon. NIST has recommended
 * allowing paste and reveal for years — hiding the password from the person
 * typing it produces weaker passwords, not stronger ones.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false);

    return (
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        className={cn("pr-10", className)}
        rightAddon={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-pressed={visible}
            aria-label={visible ? "Hide password" : "Show password"}
            className={cn(
              "text-muted-foreground flex size-6 items-center justify-center rounded-sm",
              "hover:text-foreground transition-colors",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            )}
          >
            {visible ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        }
        {...props}
      />
    );
  },
);
