"use client";

import {
  AlertTriangle,
  Bell,
  CreditCard,
  Database,
  FileDown,
  HardDrive,
  Mail,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { NOTIFICATION_KIND_STYLES, cn } from "@/lib/utils";
import type { NotificationKind } from "@/types";

const ICONS: Record<NotificationKind, LucideIcon> = {
  EMAIL_SENT: Mail,
  REMINDER_SENT: Bell,
  PAYMENT_RECEIVED: Wallet,
  CREDIT_OVERDUE: AlertTriangle,
  DATA_DELETION_WARNING: Database,
  EXPORT_READY: FileDown,
  STORAGE_WARNING: HardDrive,
  SYSTEM: CreditCard,
};

export interface NotificationIconProps {
  kind: NotificationKind;
  size?: "sm" | "md";
  className?: string;
}

/**
 * The icon is decorative — aria-hidden. The kind is already in the notification's
 * title and, where it matters, in a badge; an icon announced as "alert triangle"
 * adds noise, not meaning.
 */
export function NotificationIcon({ kind, size = "md", className }: NotificationIconProps) {
  const Icon = ICONS[kind];
  const style = NOTIFICATION_KIND_STYLES[kind];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        size === "sm" ? "size-8" : "size-9",
        style.className,
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} />
    </span>
  );
}
