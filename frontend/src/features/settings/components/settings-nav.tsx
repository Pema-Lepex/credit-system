"use client";

import {
  Bell,
  Building2,
  Database,
  HardDrive,
  Mail,
  Trash2,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";
import type { Permission } from "@/types";

export interface SettingsSection {
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
  permission?: Permission;
}

/** One list, used by both the sub-nav below and the /settings index cards. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    label: "Business",
    href: "/settings/business",
    icon: Building2,
    description: "Profile, contact details, location, currency, working hours and branding.",
    permission: "settings:read",
  },
  {
    label: "Users",
    href: "/settings/users",
    icon: Users,
    description: "Invite staff, set roles, deactivate accounts.",
    permission: "user:manage",
  },
  {
    label: "Email templates",
    href: "/settings/email-templates",
    icon: Mail,
    description: "Edit the emails your customers receive, with a live preview.",
    permission: "settings:read",
  },
  {
    label: "Reminders",
    href: "/settings/reminders",
    icon: Bell,
    description: "When reminders go out, who receives them, and what has been sent.",
    permission: "settings:read",
  },
  {
    label: "Storage",
    href: "/settings/storage",
    icon: HardDrive,
    description: "Usage against your quota, maintenance tools and database backup.",
    permission: "storage:read",
  },
  {
    label: "Data retention",
    href: "/settings/data-retention",
    icon: Database,
    description: "How long closed records are kept, and what is scheduled for deletion.",
    permission: "settings:read",
  },
  {
    label: "Trash",
    href: "/settings/trash",
    icon: Trash2,
    description: "Deleted credits and payments — restore them or delete them permanently.",
    permission: "credit:delete",
  },
  {
    label: "Profile",
    href: "/settings/profile",
    icon: User,
    description: "Your own name, avatar, appearance and password.",
  },
];

/**
 * Horizontal sub-nav across the settings screens.
 *
 * It matters most on mobile, where the sidebar (and its nested settings links) is
 * behind a hamburger — without this, moving between settings pages is a two-tap
 * round trip through a drawer.
 *
 * A <nav> of links, not tabs: each destination is a real route with its own URL,
 * and role="tablist" on a set of links lies to a screen reader about what Enter
 * will do.
 */
export function SettingsNav() {
  const pathname = usePathname();
  const { hasPermission } = useAuth();

  const sections = SETTINGS_SECTIONS.filter(
    (section) => !section.permission || hasPermission(section.permission),
  );

  return (
    <nav aria-label="Settings sections" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 px-1 pb-1">
        {sections.map((section) => {
          const active = pathname === section.href;
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap",
                  "transition-colors",
                  "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
                  active
                    ? "bg-primary-soft text-primary-soft-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <section.icon className="size-4 shrink-0" aria-hidden="true" />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
