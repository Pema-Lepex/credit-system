import {
  Bell,
  Boxes,
  Building2,
  CreditCard,
  Database,
  FileText,
  HardDrive,
  LayoutDashboard,
  Mail,
  Package,
  Receipt,
  Settings,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { Permission } from "@/types";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Hidden unless the user holds this permission. UI affordance only — the API re-checks. */
  permission?: Permission;
  children?: NavItem[];
  /** Match child routes too (/credits/123 lights up /credits). */
  matchNested?: boolean;
}

export interface NavGroup {
  /** Rendered as a section heading in the sidebar; omit for the first group. */
  label?: string;
  items: NavItem[];
}

/**
 * Single source of truth for navigation, breadcrumbs AND the command palette.
 * Three copies of a nav tree is three chances to drift.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Operations",
    items: [
      {
        label: "Credits",
        href: "/credits",
        icon: CreditCard,
        permission: "credit:read",
        matchNested: true,
      },
      {
        label: "Customers",
        href: "/customers",
        icon: Users,
        permission: "customer:read",
        matchNested: true,
      },
      {
        label: "Payments",
        href: "/payments",
        icon: Receipt,
        permission: "payment:read",
        matchNested: true,
      },
    ],
  },
  {
    label: "Catalog",
    items: [
      {
        label: "Products",
        href: "/products",
        icon: Package,
        permission: "catalog:read",
        matchNested: true,
      },
      {
        label: "Services",
        href: "/services",
        icon: Wrench,
        permission: "catalog:read",
        matchNested: true,
      },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "Reports", href: "/reports", icon: FileText, permission: "report:read" },
      { label: "Notifications", href: "/notifications", icon: Bell },
    ],
  },
  {
    label: "Configuration",
    items: [
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
        permission: "settings:read",
        matchNested: true,
        children: [
          {
            label: "Business",
            href: "/settings/business",
            icon: Building2,
            permission: "settings:read",
          },
          { label: "Users", href: "/settings/users", icon: Users, permission: "user:read" },
          {
            label: "Email Templates",
            href: "/settings/email-templates",
            icon: Mail,
            permission: "settings:read",
          },
          {
            label: "Reminders",
            href: "/settings/reminders",
            icon: Bell,
            permission: "settings:read",
          },
          {
            label: "Storage",
            href: "/settings/storage",
            icon: HardDrive,
            permission: "storage:read",
          },
          {
            label: "Data Retention",
            href: "/settings/data-retention",
            icon: Database,
            permission: "settings:read",
          },
        ],
      },
    ],
  },
];

/** Flat list — what the command palette searches and breadcrumbs resolve against. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) =>
  group.items.flatMap((item) => [item, ...(item.children ?? [])]),
);

export const FALLBACK_ICON = Boxes;

/** Human label for a URL segment; falls back to Title Case of the segment. */
export function labelForHref(href: string): string {
  const match = NAV_ITEMS.find((item) => item.href === href);
  if (match) return match.label;
  const segment = href.split("/").filter(Boolean).pop() ?? "";
  return segment
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function isActiveHref(pathname: string, item: NavItem): boolean {
  if (pathname === item.href) return true;
  if (item.matchNested) return pathname.startsWith(`${item.href}/`);
  return false;
}
