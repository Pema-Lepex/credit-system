"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  /** The formatted headline. Already compacted/currency-formatted by the caller. */
  value: string;
  /** The exact, uncompacted value — announced to AT and shown on hover. */
  exactValue?: string;
  /** Secondary line: a count, a comparison, a qualifier. */
  hint?: ReactNode;
  icon: ReactNode;
  /**
   * The period-over-period change, in percent.
   *
   * `null` means THERE IS NO BASELINE (no collections last month, a business one
   * day old). It does not mean 0%. A green "+0%" arrow against nothing is a
   * fabricated fact, so null renders a dash and says why.
   *
   * `undefined` means the API does not compute a delta for this metric at all —
   * the row simply does not appear.
   */
  deltaPercent?: number | null;
  /** What the delta is measured against, e.g. "vs last month". */
  deltaLabel?: string;
  /** For most metrics up is good; for Overdue it is not. Drives the delta's colour. */
  upIsGood?: boolean;
  /** Makes the whole card a link — the number and its list belong together. */
  href?: string;
  tone?: "neutral" | "destructive" | "warning" | "success";
}

const TONE_ICON: Record<NonNullable<StatCardProps["tone"]>, string> = {
  neutral: "bg-muted text-muted-foreground",
  destructive: "bg-destructive-soft text-destructive-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
  success: "bg-success-soft text-success-soft-foreground",
};

function Delta({
  deltaPercent,
  deltaLabel,
  upIsGood = true,
}: Pick<StatCardProps, "deltaPercent" | "deltaLabel" | "upIsGood">) {
  if (deltaPercent === undefined) return null;

  if (deltaPercent === null) {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Minus aria-hidden="true" className="size-3.5" />
        <span>No {deltaLabel ?? "prior period"} to compare against</span>
      </p>
    );
  }

  const flat = Math.abs(deltaPercent) < 0.05;
  const up = deltaPercent > 0;
  const good = flat ? null : up === upIsGood;

  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;

  return (
    <p className="flex items-center gap-1.5 text-xs">
      <span
        className={cn(
          "flex items-center gap-0.5 font-medium tabular",
          // Colour is a reinforcement, never the message: the arrow's direction and
          // the signed number both say it too (WCAG 1.4.1).
          good === null
            ? "text-muted-foreground"
            : good
              ? "text-success-soft-foreground"
              : "text-destructive-soft-foreground",
        )}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        {flat ? "0%" : `${up ? "+" : ""}${deltaPercent.toFixed(1)}%`}
      </span>
      {deltaLabel ? <span className="text-muted-foreground">{deltaLabel}</span> : null}
    </p>
  );
}

export function StatCard({
  label,
  value,
  exactValue,
  hint,
  icon,
  deltaPercent,
  deltaLabel,
  upIsGood = true,
  href,
  tone = "neutral",
}: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground text-sm font-medium">{label}</p>
        <span
          aria-hidden="true"
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
            TONE_ICON[tone],
          )}
        >
          {icon}
        </span>
      </div>

      <div className="space-y-1">
        {/* Proportional figures, not tabular: a display-size number set in tabular
            digits reads loose. Tabular is for columns, and this is not a column. */}
        <p
          className="text-foreground truncate text-2xl leading-tight font-semibold tracking-tight"
          title={exactValue ?? value}
        >
          <span aria-hidden={exactValue ? "true" : undefined}>{value}</span>
          {exactValue ? <span className="sr-only">{exactValue}</span> : null}
        </p>
        {hint ? <p className="text-muted-foreground truncate text-xs">{hint}</p> : null}
        <Delta deltaPercent={deltaPercent} deltaLabel={deltaLabel} upIsGood={upIsGood} />
      </div>
    </>
  );

  if (href) {
    return (
      <Card interactive className="p-0">
        <Link
          href={href}
          className="focus-visible:ring-ring flex h-full flex-col gap-3 rounded-lg p-5 focus-visible:ring-2 focus-visible:outline-none"
        >
          {body}
        </Link>
      </Card>
    );
  }

  return <Card className="flex flex-col gap-3 p-5">{body}</Card>;
}
