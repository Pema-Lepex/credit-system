import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type {
  ApprovalStatus,
  CreditStatus,
  CustomerStatus,
  ExportState,
  NotificationKind,
  NotificationState,
  PaymentMethod,
  ReminderStatus,
  Role,
} from "@/types";

/**
 * The one class-merging helper. clsx resolves conditionals, tailwind-merge
 * resolves *conflicts* — without it `cn("p-2", props.className)` silently loses
 * to specificity roulette when the caller passes `p-4`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Re-exported so callers have one import site for formatting + classnames.
export * from "./format";

// ---------------------------------------------------------------------------
// Status → token maps
//
// Every entry uses the *soft* token pair (see globals.css): a tinted surface plus
// a foreground that clears 4.5:1 against the tint, the card AND the page. Solid
// --destructive as text would be only 4.10:1 on the dark background.
//
// Colour is never the sole carrier of meaning — each map ships a `label` too, and
// the Badge renders it. That is WCAG 1.4.1.
// ---------------------------------------------------------------------------
export interface StatusStyle {
  label: string;
  /** Tailwind classes for a tinted chip. */
  className: string;
  /** Bare foreground colour class, for text/dot-only contexts. */
  dot: string;
}

export const CREDIT_STATUS_STYLES: Record<CreditStatus, StatusStyle> = {
  PENDING: {
    label: "Pending",
    className: "bg-neutral-soft text-neutral-soft-foreground",
    dot: "bg-neutral-soft-foreground",
  },
  PARTIALLY_PAID: {
    label: "Partially paid",
    className: "bg-info-soft text-info-soft-foreground",
    dot: "bg-info-soft-foreground",
  },
  PAID: {
    label: "Paid",
    className: "bg-success-soft text-success-soft-foreground",
    dot: "bg-success-soft-foreground",
  },
  OVERDUE: {
    label: "Overdue",
    className: "bg-destructive-soft text-destructive-soft-foreground",
    dot: "bg-destructive-soft-foreground",
  },
  CANCELLED: {
    label: "Cancelled",
    className: "bg-neutral-soft text-neutral-soft-foreground line-through decoration-1",
    dot: "bg-neutral-soft-foreground",
  },
};

export const CUSTOMER_STATUS_STYLES: Record<CustomerStatus, StatusStyle> = {
  ACTIVE: {
    label: "Active",
    className: "bg-success-soft text-success-soft-foreground",
    dot: "bg-success-soft-foreground",
  },
  INACTIVE: {
    label: "Inactive",
    className: "bg-neutral-soft text-neutral-soft-foreground",
    dot: "bg-neutral-soft-foreground",
  },
  BLOCKED: {
    label: "Blocked",
    className: "bg-warning-soft text-warning-soft-foreground",
    dot: "bg-warning-soft-foreground",
  },
  DEFAULTED: {
    label: "Defaulted",
    className: "bg-destructive-soft text-destructive-soft-foreground",
    dot: "bg-destructive-soft-foreground",
  },
};

export const REMINDER_STATUS_STYLES: Record<ReminderStatus, StatusStyle> = {
  SCHEDULED: {
    label: "Scheduled",
    className: "bg-info-soft text-info-soft-foreground",
    dot: "bg-info-soft-foreground",
  },
  SENT: {
    label: "Sent",
    className: "bg-success-soft text-success-soft-foreground",
    dot: "bg-success-soft-foreground",
  },
  FAILED: {
    label: "Failed",
    className: "bg-destructive-soft text-destructive-soft-foreground",
    dot: "bg-destructive-soft-foreground",
  },
  SKIPPED: {
    label: "Skipped",
    className: "bg-neutral-soft text-neutral-soft-foreground",
    dot: "bg-neutral-soft-foreground",
  },
  CANCELLED: {
    label: "Cancelled",
    className: "bg-neutral-soft text-neutral-soft-foreground",
    dot: "bg-neutral-soft-foreground",
  },
};

export const EXPORT_STATE_STYLES: Record<ExportState, StatusStyle> = {
  PENDING: {
    label: "Queued",
    className: "bg-neutral-soft text-neutral-soft-foreground",
    dot: "bg-neutral-soft-foreground",
  },
  RUNNING: {
    label: "Running",
    className: "bg-info-soft text-info-soft-foreground",
    dot: "bg-info-soft-foreground",
  },
  READY: {
    label: "Ready",
    className: "bg-success-soft text-success-soft-foreground",
    dot: "bg-success-soft-foreground",
  },
  FAILED: {
    label: "Failed",
    className: "bg-destructive-soft text-destructive-soft-foreground",
    dot: "bg-destructive-soft-foreground",
  },
  EXPIRED: {
    label: "Expired",
    className: "bg-neutral-soft text-neutral-soft-foreground",
    dot: "bg-neutral-soft-foreground",
  },
};

export const NOTIFICATION_STATE_STYLES: Record<NotificationState, StatusStyle> = {
  UNREAD: {
    label: "Unread",
    className: "bg-primary-soft text-primary-soft-foreground",
    dot: "bg-primary-soft-foreground",
  },
  READ: {
    label: "Read",
    className: "bg-neutral-soft text-neutral-soft-foreground",
    dot: "bg-neutral-soft-foreground",
  },
  ARCHIVED: {
    label: "Archived",
    className: "bg-neutral-soft text-neutral-soft-foreground",
    dot: "bg-neutral-soft-foreground",
  },
};

export const NOTIFICATION_KIND_STYLES: Record<NotificationKind, StatusStyle> = {
  EMAIL_SENT: {
    label: "Email sent",
    className: "bg-info-soft text-info-soft-foreground",
    dot: "bg-info-soft-foreground",
  },
  REMINDER_SENT: {
    label: "Reminder sent",
    className: "bg-info-soft text-info-soft-foreground",
    dot: "bg-info-soft-foreground",
  },
  PAYMENT_RECEIVED: {
    label: "Payment received",
    className: "bg-success-soft text-success-soft-foreground",
    dot: "bg-success-soft-foreground",
  },
  CREDIT_OVERDUE: {
    label: "Credit overdue",
    className: "bg-destructive-soft text-destructive-soft-foreground",
    dot: "bg-destructive-soft-foreground",
  },
  DATA_DELETION_WARNING: {
    label: "Deletion warning",
    className: "bg-warning-soft text-warning-soft-foreground",
    dot: "bg-warning-soft-foreground",
  },
  EXPORT_READY: {
    label: "Export ready",
    className: "bg-success-soft text-success-soft-foreground",
    dot: "bg-success-soft-foreground",
  },
  STORAGE_WARNING: {
    label: "Storage warning",
    className: "bg-warning-soft text-warning-soft-foreground",
    dot: "bg-warning-soft-foreground",
  },
  SYSTEM: {
    label: "System",
    className: "bg-neutral-soft text-neutral-soft-foreground",
    dot: "bg-neutral-soft-foreground",
  },
};

export const APPROVAL_STATUS_STYLES: Record<ApprovalStatus, StatusStyle> = {
  PENDING: {
    label: "Pending",
    className: "bg-warning-soft text-warning-soft-foreground",
    dot: "bg-warning-soft-foreground",
  },
  APPROVED: {
    label: "Approved",
    className: "bg-success-soft text-success-soft-foreground",
    dot: "bg-success-soft-foreground",
  },
  REJECTED: {
    label: "Rejected",
    className: "bg-destructive-soft text-destructive-soft-foreground",
    dot: "bg-destructive-soft-foreground",
  },
  SUSPENDED: {
    label: "Suspended",
    className: "bg-neutral-soft text-neutral-soft-foreground",
    dot: "bg-neutral-soft-foreground",
  },
};

export const ROLE_STYLES: Record<Role, StatusStyle> = {
  SUPER_ADMIN: {
    label: "Super admin",
    className: "bg-primary-soft text-primary-soft-foreground",
    dot: "bg-primary-soft-foreground",
  },
  ADMIN: {
    label: "Admin",
    className: "bg-info-soft text-info-soft-foreground",
    dot: "bg-info-soft-foreground",
  },
  STAFF: {
    label: "Staff",
    className: "bg-neutral-soft text-neutral-soft-foreground",
    dot: "bg-neutral-soft-foreground",
  },
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  MOBILE_MONEY: "Mobile money",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

/** Credit score 0-100 -> a tone. Same soft-token discipline as above. */
export function creditScoreStyle(score: number): StatusStyle {
  if (score >= 75)
    return {
      label: "Excellent",
      className: "bg-success-soft text-success-soft-foreground",
      dot: "bg-success-soft-foreground",
    };
  if (score >= 50)
    return {
      label: "Good",
      className: "bg-info-soft text-info-soft-foreground",
      dot: "bg-info-soft-foreground",
    };
  if (score >= 25)
    return {
      label: "At risk",
      className: "bg-warning-soft text-warning-soft-foreground",
      dot: "bg-warning-soft-foreground",
    };
  return {
    label: "Poor",
    className: "bg-destructive-soft text-destructive-soft-foreground",
    dot: "bg-destructive-soft-foreground",
  };
}

/** Deterministic avatar tint from a string id — same user, same colour, always. */
export function avatarTint(seed: string): string {
  const palettes = [
    "bg-primary-soft text-primary-soft-foreground",
    "bg-info-soft text-info-soft-foreground",
    "bg-success-soft text-success-soft-foreground",
    "bg-warning-soft text-warning-soft-foreground",
    "bg-destructive-soft text-destructive-soft-foreground",
    "bg-neutral-soft text-neutral-soft-foreground",
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palettes[hash % palettes.length]!;
}

/** Small helper so `id` props stay stable across renders without a uuid dep. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
