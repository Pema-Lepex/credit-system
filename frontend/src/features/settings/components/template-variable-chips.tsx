"use client";

import { Plus } from "lucide-react";

import { Tooltip } from "@/components/ui";
import type { TemplateVariable } from "@/features/settings/api/templates";
import { cn } from "@/lib/utils";

export interface TemplateVariableChipsProps {
  variables: readonly TemplateVariable[];
  /** Inserts `{{name}}` at the caret of the last-focused field. */
  onInsert: (name: string) => void;
  disabled?: boolean;
}

/**
 * The available `{{variables}}`, as clickable chips.
 *
 * They are real <button>s in a labelled group, so a keyboard user tabs to them and
 * presses Enter — a div with an onClick would be a trap. Each carries a tooltip
 * with the description and a sample value, which is the difference between
 * "customer_name" and "customer_name — The customer's full name, e.g. Dorji
 * Wangchuk".
 */
export function TemplateVariableChips({
  variables,
  onInsert,
  disabled,
}: TemplateVariableChipsProps) {
  if (variables.length === 0) return null;

  return (
    <div className="space-y-2">
      <p id="variable-chips-label" className="text-foreground text-sm font-medium">
        Available variables
      </p>
      <div
        role="group"
        aria-labelledby="variable-chips-label"
        aria-describedby="variable-chips-hint"
        className="flex flex-wrap gap-1.5"
      >
        {variables.map((variable) => (
          <Tooltip
            key={variable.name}
            content={
              <span className="block max-w-56 text-left whitespace-normal">
                {variable.description}
                <span className="text-muted-foreground mt-0.5 block">e.g. {variable.example}</span>
              </span>
            }
            side="bottom"
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() => onInsert(variable.name)}
              className={cn(
                "border-border bg-muted/60 text-muted-foreground inline-flex items-center gap-1 rounded-md border px-2 py-1",
                "font-mono text-[11px] transition-colors",
                "hover:border-primary/40 hover:bg-primary-soft hover:text-primary-soft-foreground",
                "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              <Plus className="size-3" aria-hidden="true" />
              {/* The braces are visual noise in the chip, but the accessible name
                  must say exactly what will be inserted. */}
              <span aria-hidden="true">{variable.name}</span>
              <span className="sr-only">
                Insert {`{{${variable.name}}}`} — {variable.description}
              </span>
            </button>
          </Tooltip>
        ))}
      </div>
      <p id="variable-chips-hint" className="text-muted-foreground text-xs">
        Click a variable to insert it where your cursor is. It is replaced with the real value
        when the email is sent.
      </p>
    </div>
  );
}
