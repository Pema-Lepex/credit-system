"use client";

import { Copy } from "lucide-react";

import { Button, Input, Switch } from "@/components/ui";
import { DAYS, type WorkingHoursValues } from "@/features/settings/lib/schemas";
import { cn } from "@/lib/utils";

export interface WorkingHoursEditorProps {
  value: WorkingHoursValues;
  onChange: (value: WorkingHoursValues) => void;
  disabled?: boolean;
}

/**
 * Seven-day opening-hours editor for the `workingHours` JSON column.
 *
 * "Closed" is a switch rather than blanking the times, because a shop that closes
 * on Sunday still has hours it *would* open — clearing them means retyping 09:00
 * every time the owner reopens. Closed days keep their times and grey them out.
 *
 * "Copy to all days" exists because the alternative is fourteen time fields, and
 * most businesses have one schedule with an exception or two.
 */
export function WorkingHoursEditor({ value, onChange, disabled }: WorkingHoursEditorProps) {
  const setDay = (key: keyof WorkingHoursValues, patch: Partial<WorkingHoursValues["mon"]>) => {
    onChange({ ...value, [key]: { ...value[key], ...patch } });
  };

  const copyToAll = (key: keyof WorkingHoursValues) => {
    const source = value[key];
    const next = { ...value };
    for (const day of DAYS) {
      // Copy the times, but never override which days are closed — that is the
      // one thing that genuinely differs day to day.
      next[day.key] = { ...next[day.key], open: source.open, close: source.close };
    }
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {DAYS.map(({ key, label }) => {
        const day = value[key];
        const isClosed = day.closed;

        return (
          <div
            key={key}
            className={cn(
              "border-border grid gap-3 rounded-lg border p-3",
              "grid-cols-1 sm:grid-cols-[8rem_1fr_auto] sm:items-center",
            )}
          >
            <div className="flex items-center gap-3">
              <Switch
                checked={!isClosed}
                onCheckedChange={(open) => setDay(key, { closed: !open })}
                disabled={disabled}
                size="sm"
                label={`${label}: ${isClosed ? "closed" : "open"}`}
              />
              <span className="text-foreground text-sm font-medium">{label}</span>
            </div>

            {isClosed ? (
              <p className="text-muted-foreground text-sm">Closed</p>
            ) : (
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`hours-${key}-open`}>
                  {label} opening time
                </label>
                <Input
                  id={`hours-${key}-open`}
                  type="time"
                  inputSize="sm"
                  className="w-auto"
                  disabled={disabled}
                  value={day.open}
                  onChange={(event) => setDay(key, { open: event.target.value })}
                />
                <span className="text-muted-foreground text-sm" aria-hidden="true">
                  to
                </span>
                <label className="sr-only" htmlFor={`hours-${key}-close`}>
                  {label} closing time
                </label>
                <Input
                  id={`hours-${key}-close`}
                  type="time"
                  inputSize="sm"
                  className="w-auto"
                  disabled={disabled}
                  value={day.close}
                  onChange={(event) => setDay(key, { close: event.target.value })}
                />
              </div>
            )}

            <div className="flex justify-start sm:justify-end">
              {!isClosed ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  leftIcon={<Copy />}
                  onClick={() => copyToAll(key)}
                >
                  <span className="sr-only">Copy {label} hours to all days</span>
                  <span aria-hidden="true">Copy to all</span>
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
