"use client";

/**
 * One tooltip for every chart on the page.
 *
 * Recharts clones the element passed to `content` and injects `active`, `payload`
 * and `label` — which is why those props are optional here and are never passed at
 * the call site. The rest of the props (the formatter) are ours.
 *
 * A tooltip ENHANCES; it never gates. Every value it shows is also in the chart's
 * table-view twin (see ChartCard) and on the axis, so a keyboard or screen-reader
 * user is never asked to hover to learn a number.
 */

export interface ChartTooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
  payload?: unknown;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartTooltipEntry[];
  label?: string | number;
  /** Formats a series value. Money goes through the business's currency formatter. */
  formatValue: (value: number) => string;
  /** Overrides the row label; defaults to the series `name`. */
  labelFor?: (entry: ChartTooltipEntry) => string;
}

function toNumber(value: ChartTooltipEntry["value"]): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
  labelFor,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="border-border bg-popover text-popover-foreground min-w-40 rounded-lg border px-3 py-2 shadow-lg">
      {label !== undefined ? (
        <p className="text-muted-foreground mb-1.5 text-xs font-medium">{label}</p>
      ) : null}
      <ul className="space-y-1">
        {payload.map((entry, index) => (
          <li
            key={`${String(entry.dataKey ?? index)}`}
            className="flex items-center justify-between gap-4 text-xs"
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground">
                {labelFor ? labelFor(entry) : String(entry.name ?? entry.dataKey ?? "")}
              </span>
            </span>
            <span className="text-foreground tabular font-medium">
              {formatValue(toNumber(entry.value))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
