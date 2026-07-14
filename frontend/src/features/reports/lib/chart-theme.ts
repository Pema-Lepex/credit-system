"use client";

/**
 * Chart colours, read from the design system's CSS custom properties at runtime.
 *
 * WHY NOT HARDCODE HEXES: globals.css defines --chart-1..5 twice — once for light,
 * once for dark — and each set is contrast-checked against its own surface. A
 * hardcoded `#4f46e5` is correct in exactly one of the two themes and is wrong the
 * moment someone flips the toggle. Recharts wants real colour strings (it computes
 * legend swatches and tooltip borders in JS), so we resolve the variables through
 * getComputedStyle and re-resolve whenever the theme changes.
 *
 * The series order is FIXED. Chart 1 is always chart-1, for every chart on every
 * page — colour follows the entity, never its rank in the current filter.
 */

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export interface ChartColors {
  /** The categorical series, in fixed order. */
  series: [string, string, string, string, string];
  grid: string;
  axis: string;
  surface: string;
  border: string;
  foreground: string;
  /** Semantic tones for money in vs money out — never reused as a series colour. */
  positive: string;
  negative: string;
}

/** Used for the first paint and on the server, where there is no computed style. */
const FALLBACK: ChartColors = {
  series: ["#4f46e5", "#0284c7", "#059669", "#d97706", "#db2777"],
  grid: "#e5e7eb",
  axis: "#6b7280",
  surface: "#ffffff",
  border: "#e5e7eb",
  foreground: "#1f2937",
  positive: "#059669",
  negative: "#dc2626",
};

export function useChartColors(): ChartColors {
  const { resolvedTheme } = useTheme();
  const [colors, setColors] = useState<ChartColors>(FALLBACK);

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string): string => {
      const value = styles.getPropertyValue(name).trim();
      return value === "" ? fallback : value;
    };

    setColors({
      series: [
        read("--chart-1", FALLBACK.series[0]),
        read("--chart-2", FALLBACK.series[1]),
        read("--chart-3", FALLBACK.series[2]),
        read("--chart-4", FALLBACK.series[3]),
        read("--chart-5", FALLBACK.series[4]),
      ],
      grid: read("--border", FALLBACK.grid),
      axis: read("--muted-foreground", FALLBACK.axis),
      surface: read("--card", FALLBACK.surface),
      border: read("--border", FALLBACK.border),
      foreground: read("--foreground", FALLBACK.foreground),
      positive: read("--success", FALLBACK.positive),
      negative: read("--destructive", FALLBACK.negative),
    });
    // resolvedTheme is the dependency that matters: the `.dark` class on <html> is
    // what swaps the variable values, and it changes without a remount.
  }, [resolvedTheme]);

  return colors;
}
