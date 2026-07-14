"use client";

/**
 * The credit score, shown two ways.
 *
 * A score is an accusation until it is explained. `customerScore(id)` returns the
 * number AND the reasons that produced it ("2 credits currently overdue: -20"),
 * and the panel renders both — the shopkeeper looking at 34 can see exactly which
 * behaviour cost the points, and tell the customer.
 *
 * The reason strings end in ": +N" / ": -N" (see backend `_score`). We parse that
 * tail to tone each line, and never *recompute* anything: the server owns the
 * arithmetic, we only present it.
 */

import { Minus, Plus, TrendingDown } from "lucide-react";

import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import { cn, creditScoreStyle } from "@/lib/utils";

/** 0-100 → a track fill and a tone. Matches creditScoreStyle's bands exactly. */
function scoreBarClass(score: number): string {
  if (score >= 75) return "bg-success";
  if (score >= 50) return "bg-info-soft-foreground";
  if (score >= 25) return "bg-warning-soft-foreground";
  return "bg-destructive";
}

export interface CreditScoreCellProps {
  score: number;
  className?: string;
}

/** Table cell: the number, banded. A 34 must read as a warning, not as data. */
export function CreditScoreCell({ score, className }: CreditScoreCellProps) {
  const style = creditScoreStyle(score);

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Badge variant="neutral" size="sm" className={cn("tabular", style.className)}>
        {score}
      </Badge>
      <span
        aria-hidden="true"
        className="bg-muted hidden h-1.5 w-12 overflow-hidden rounded-full lg:block"
      >
        <span
          className={cn("block h-full rounded-full", scoreBarClass(score))}
          style={{ width: `${Math.max(2, score)}%` }}
        />
      </span>
      <span className="sr-only">{style.label}</span>
    </span>
  );
}

interface ParsedReason {
  text: string;
  delta: number | null;
}

function parseReason(reason: string): ParsedReason {
  const match = /:\s*([+-])(\d+)\s*$/.exec(reason);
  if (!match) return { text: reason, delta: null };
  const sign = match[1] === "-" ? -1 : 1;
  return { text: reason.slice(0, match.index), delta: sign * Number(match[2]) };
}

export interface CreditScorePanelProps {
  score: number | undefined;
  reasons: string[] | undefined;
  isLoading: boolean;
  className?: string;
}

export function CreditScorePanel({
  score,
  reasons,
  isLoading,
  className,
}: CreditScorePanelProps) {
  if (isLoading || score === undefined) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Credit score</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const style = creditScoreStyle(score);
  const all = (reasons ?? []).map(parseReason);
  // The backend's last line is "Final score: N out of 100." — that is the number
  // we are already showing three times its size, not a reason.
  const summary = all.at(-1)?.text.startsWith("Final score") ? all.at(-1) : undefined;
  const items = summary ? all.slice(0, -1) : all;

  return (
    <Card className={className}>
      <CardHeader className="pb-4">
        <CardTitle>Credit score</CardTitle>
      </CardHeader>

      <CardContent className="space-y-5 pt-0">
        <div className="flex items-end gap-4">
          <div className="flex items-baseline gap-1">
            <span className="tabular text-5xl leading-none font-semibold tracking-tight">
              {score}
            </span>
            <span className="text-muted-foreground text-sm">/ 100</span>
          </div>
          <Badge className={cn("mb-1", style.className)} dot>
            {style.label}
          </Badge>
        </div>

        {/* The meter is decorative — the number and the band label carry the
            meaning, so AT gets them and not a second reading of the same value. */}
        <div className="space-y-1.5">
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full" aria-hidden="true">
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", scoreBarClass(score))}
              style={{ width: `${Math.max(2, score)}%` }}
            />
          </div>
          <div
            className="text-muted-foreground flex justify-between text-[10px] font-medium"
            aria-hidden="true"
          >
            <span>0 Poor</span>
            <span>25</span>
            <span>50</span>
            <span>75</span>
            <span>100 Excellent</span>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            Why this score
          </h3>
          <ul className="space-y-1.5">
            {items.map((reason, index) => {
              const positive = (reason.delta ?? 0) > 0;
              const negative = (reason.delta ?? 0) < 0;
              return (
                <li
                  key={`${reason.text}-${index}`}
                  className="border-border/60 flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
                      positive
                        ? "bg-success-soft text-success-soft-foreground"
                        : negative
                          ? "bg-destructive-soft text-destructive-soft-foreground"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {positive ? (
                      <Plus className="size-3" />
                    ) : negative ? (
                      <Minus className="size-3" />
                    ) : (
                      <TrendingDown className="size-3" />
                    )}
                  </span>
                  <span className="text-foreground min-w-0 flex-1 leading-snug">
                    {reason.text}
                  </span>
                  {reason.delta !== null ? (
                    <span
                      className={cn(
                        "tabular shrink-0 text-sm font-semibold",
                        positive
                          ? "text-success-soft-foreground"
                          : "text-destructive-soft-foreground",
                      )}
                    >
                      {reason.delta > 0 ? `+${reason.delta}` : reason.delta}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="text-muted-foreground pt-1 text-xs leading-relaxed">
            Everyone starts at 50. This is an internal heuristic from this
            business&rsquo;s own payment history — not a credit-bureau rating.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
