"use client";

import { forwardRef } from "react";

import { Input } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface ColorFieldProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  invalid?: boolean;
  "aria-describedby"?: string;
}

/**
 * A hex colour, editable two ways: the OS colour picker AND a text field.
 *
 * The native <input type="color"> alone is not enough — it cannot be typed into,
 * so a brand hex from a style guide has to be eyedropped by hand, and it exposes
 * no text value to a screen reader. The text input is the accessible control (it
 * carries the id and the label); the swatch is an optional convenience beside it.
 */
export const ColorField = forwardRef<HTMLInputElement, ColorFieldProps>(function ColorField(
  { id, value, onChange, onBlur, disabled, invalid, ...aria },
  ref,
) {
  // <input type="color"> refuses anything but #rrggbb and silently shows black.
  const swatchValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "border-border relative size-9 shrink-0 overflow-hidden rounded-md border",
          disabled && "opacity-50",
        )}
      >
        <input
          type="color"
          // Not the labelled control — the text field is. Hidden from AT so the
          // colour is not announced twice.
          aria-hidden="true"
          tabIndex={-1}
          disabled={disabled}
          value={swatchValue}
          onChange={(event) => onChange(event.target.value)}
          className="absolute -inset-2 size-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0"
        />
      </span>

      <Input
        ref={ref}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        invalid={invalid}
        spellCheck={false}
        autoComplete="off"
        placeholder="#4f46e5"
        className="font-mono"
        {...aria}
      />
    </div>
  );
});
