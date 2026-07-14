"use client";

import { Badge } from "@/components/ui";
import { CREDIT_STATUS_STYLES, cn, formatDueDate } from "@/lib/utils";
import type { CreditStatus, ISODate } from "@/types";

/**
 * Status chips.
 *
 * They use the *soft* token pairs from globals.css, whose foregrounds are the only
 * ones that clear 4.5:1 against the page, the card AND their own tint in both
 * themes. And each one carries a LABEL — colour is never the sole signal.
 */
export function CreditStatusBadge({
  status,
  size = "md",
}: {
  status: CreditStatus;
  size?: "sm" | "md";
}) {
  const style = CREDIT_STATUS_STYLES[status];
  return (
    <Badge size={size} className={cn(style.className)} dot dotClassName={style.dot}>
      {style.label}
    </Badge>
  );
}

const TONE_VARIANT = {
  neutral: "neutral",
  warning: "warning",
  destructive: "destructive",
  success: "success",
} as const;

/**
 * "3 days overdue" / "Due today" / "Due in 5 days".
 *
 * The *language* of the due date is the product. A raw "2026-07-21" makes the
 * shopkeeper do date arithmetic in their head, every row, every morning.
 *
 * A settled credit has no countdown — chasing a customer who has already paid is
 * the worst thing this app could do — so PAID/CANCELLED render nothing.
 */
export function DueDateBadge({
  dueDate,
  status,
  size = "md",
}: {
  dueDate: ISODate;
  status?: CreditStatus;
  size?: "sm" | "md";
}) {
  if (status === "PAID" || status === "CANCELLED") return null;

  const { label, tone } = formatDueDate(dueDate);
  return (
    <Badge size={size} variant={TONE_VARIANT[tone]}>
      {label}
    </Badge>
  );
}
