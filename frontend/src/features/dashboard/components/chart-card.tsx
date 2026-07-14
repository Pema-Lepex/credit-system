"use client";

import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface ChartDataTable {
  caption: string;
  columns: string[];
  rows: string[][];
}

export interface ChartCardProps {
  title: string;
  description?: string;
  /** Rendered top-right — a legend, a total, a filter. */
  aside?: ReactNode;
  children: ReactNode;
  /**
   * The table-view twin. A chart is a picture of numbers; a screen-reader user
   * gets the numbers. It is `sr-only` rather than absent, because a colour-encoded
   * SVG is not an accessible way to read a value — the table is.
   */
  table?: ChartDataTable;
  className?: string;
}

export function ChartCard({
  title,
  description,
  aside,
  children,
  table,
  className,
}: ChartCardProps) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
        <div className="min-w-0 space-y-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col">
        {children}

        {table ? (
          <table className="sr-only">
            <caption>{table.caption}</caption>
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) =>
                    cellIndex === 0 ? (
                      <th key={cellIndex} scope="row">
                        {cell}
                      </th>
                    ) : (
                      <td key={cellIndex}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Legend / direct-label key. The colour lives on the SWATCH, never on the text —
 * chart-4 (amber) as label text would be illegible on the card surface, and text
 * that wears the data colour fails contrast the moment the palette shifts.
 */
export function LegendKey({
  color,
  label,
  value,
  shape = "square",
}: {
  color: string;
  label: string;
  value?: string;
  shape?: "square" | "line";
}) {
  return (
    <span className="flex items-center gap-2 text-xs">
      <span
        aria-hidden="true"
        className={cn("shrink-0 rounded-full", shape === "line" ? "h-0.5 w-3" : "size-2.5")}
        style={{ backgroundColor: color }}
      />
      <span className="text-muted-foreground">{label}</span>
      {value ? <span className="text-foreground tabular font-medium">{value}</span> : null}
    </span>
  );
}
