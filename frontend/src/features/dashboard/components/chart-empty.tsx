"use client";

import { LineChart } from "lucide-react";

import { Skeleton } from "@/components/ui";

/**
 * A brand-new business has no data, and this is the first screen it sees. An empty
 * chart axis with no marks reads as "broken"; a sentence that says what will
 * appear here reads as "not yet". They are the same pixels and completely
 * different products.
 */
export function ChartEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="border-border flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center sm:h-72">
      <div
        aria-hidden="true"
        className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-xl"
      >
        <LineChart className="size-5" />
      </div>
      <div className="max-w-xs space-y-1">
        <p className="text-foreground text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

/** Shown for the one frame between mount and reading the theme's chart tokens. */
export function ChartPlaceholder() {
  return <Skeleton className="h-64 w-full sm:h-72" />;
}
