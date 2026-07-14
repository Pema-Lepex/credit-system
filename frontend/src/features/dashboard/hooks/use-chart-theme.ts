"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import type { PaymentMethod } from "@/types";

/**
 * Chart colours, read from the design tokens at runtime.
 *
 * Recharts needs a concrete colour string for `fill`/`stroke` — it cannot take a
 * Tailwind class. The naive fix is to hardcode `#4f46e5`, which then stays indigo
 * in dark mode where the token is `#818cf8`, and silently drops below the 3:1
 * non-text contrast floor the palette was tuned to hit.
 *
 * So we read the CSS custom properties off the document element instead. They
 * re-resolve under `.dark` for free, and re-reading them whenever `resolvedTheme`
 * changes is what carries that through to the SVG.
 *
 * The values are the ones contrast-checked in globals.css — chart-1..5 all clear
 * 3:1 against the page in BOTH themes. Do not substitute a colour here without
 * re-running those numbers.
 */

export interface ChartTheme {
  /** The categorical ramp, in fixed order. Never cycled, never re-ordered by rank. */
  series: [string, string, string, string, string];
  /** Hairline grid + axis. One step off the surface, solid, recessive. */
  grid: string;
  axis: string;
  /** The card the chart sits on. Used for the 2px surface gap between marks. */
  surface: string;
  muted: string;
  foreground: string;
}

const FALLBACK: ChartTheme = {
  series: ["#4f46e5", "#0284c7", "#059669", "#d97706", "#db2777"],
  grid: "#e4e4e7",
  axis: "#52525b",
  surface: "#ffffff",
  muted: "#52525b",
  foreground: "#09090b",
};

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

export function useChartTheme(): ChartTheme | null {
  const { resolvedTheme } = useTheme();
  // null until mounted: reading getComputedStyle during SSR is impossible, and
  // rendering a chart with the light palette then repainting it dark is a flash.
  const [theme, setTheme] = useState<ChartTheme | null>(null);

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    setTheme({
      series: [
        readVar(styles, "--chart-1", FALLBACK.series[0]),
        readVar(styles, "--chart-2", FALLBACK.series[1]),
        readVar(styles, "--chart-3", FALLBACK.series[2]),
        readVar(styles, "--chart-4", FALLBACK.series[3]),
        readVar(styles, "--chart-5", FALLBACK.series[4]),
      ],
      grid: readVar(styles, "--border", FALLBACK.grid),
      axis: readVar(styles, "--muted-foreground", FALLBACK.axis),
      surface: readVar(styles, "--card", FALLBACK.surface),
      muted: readVar(styles, "--muted-foreground", FALLBACK.muted),
      foreground: readVar(styles, "--foreground", FALLBACK.foreground),
    });
    // resolvedTheme is the dependency that matters: next-themes has already put
    // `.dark` on <html> by the time this runs, so the vars read correctly.
  }, [resolvedTheme]);

  return theme;
}

/**
 * Payment method -> colour slot, BY ENTITY.
 *
 * Fixed, not rank-ordered: if the user filters MOBILE_MONEY out, CASH must stay
 * the colour it was. A reader who learned "cash is indigo" is misled by a chart
 * that repaints on filter.
 */
export const METHOD_COLOR_INDEX: Record<PaymentMethod, number> = {
  CASH: 0,
  BANK_TRANSFER: 1,
  CARD: 2,
  MOBILE_MONEY: 3,
  CHEQUE: 4,
  OTHER: 5, // past the ramp -> the muted token, not a generated 6th hue
};

export function methodColor(theme: ChartTheme, method: PaymentMethod): string {
  const index = METHOD_COLOR_INDEX[method];
  return theme.series[index] ?? theme.muted;
}
