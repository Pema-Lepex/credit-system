"use client";

import { AnimatePresence, motion } from "framer-motion";
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface FormFieldProps {
  label: string;
  /** Hide the label visually but keep it for AT (search boxes, table filters). */
  hideLabel?: boolean;
  required?: boolean;
  /** Helper text. Wired to the control via aria-describedby. */
  description?: ReactNode;
  /** Field-level error, usually `errors.email?.message` from React Hook Form. */
  error?: string;
  children: ReactElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
    "aria-required"?: boolean;
  }>;
  className?: string;
}

/**
 * The label/description/error plumbing, done once.
 *
 * Cloning the child to inject `id`, `aria-describedby` and `aria-invalid` is the
 * point: hand-wiring these on 40 inputs guarantees that at least a few end up
 * with an error message that no screen reader will ever read. Here it is
 * impossible to get wrong.
 *
 * The error region is aria-live="polite", so a validation failure that appears
 * *after* the user has moved on (async/submit-time) is still announced.
 */
export function FormField({
  label,
  hideLabel,
  required,
  description,
  error,
  children,
  className,
}: FormFieldProps) {
  const id = useId();
  const controlId = `${id}-control`;
  const descId = `${id}-description`;
  const errorId = `${id}-error`;

  const describedBy =
    [description ? descId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id ?? controlId,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required || undefined,
      })
    : children;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label
        htmlFor={children.props.id ?? controlId}
        required={required}
        className={cn(hideLabel && "sr-only")}
      >
        {label}
      </Label>

      {control}

      {description && !error ? (
        <p id={descId} className="text-muted-foreground text-xs leading-relaxed">
          {description}
        </p>
      ) : null}

      <AnimatePresence mode="wait">
        {error ? (
          <motion.p
            key={error}
            id={errorId}
            role="alert"
            aria-live="polite"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="text-destructive-soft-foreground text-xs leading-relaxed font-medium"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
