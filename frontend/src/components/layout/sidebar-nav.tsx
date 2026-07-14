"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { NAV_GROUPS, isActiveHref, type NavItem } from "@/components/layout/nav-config";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";

interface SidebarNavProps {
  /** Icons only. Labels move into tooltips so the rail stays usable. */
  collapsed?: boolean;
  /** Mobile drawer: close it after a navigation, or the user stares at the menu. */
  onNavigate?: () => void;
}

export function SidebarNav({ collapsed = false, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const { hasPermission, isLoading } = useAuth();

  /**
   * Permission filtering. While auth is still loading we show everything rather
   * than nothing — a nav that pops items in one by one after hydration is worse
   * than one that occasionally shows a link the user can't use (the server will
   * reject it anyway, and the route itself re-checks).
   */
  const groups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => isLoading || !item.permission || hasPermission(item.permission),
        ),
      })).filter((group) => group.items.length > 0),
    [hasPermission, isLoading],
  );

  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 py-4">
      {groups.map((group, index) => (
        <div key={group.label ?? `group-${index}`} className="flex flex-col gap-1">
          {group.label && !collapsed ? (
            <h2 className="text-muted-foreground px-2.5 pb-1 text-[11px] font-semibold tracking-wider uppercase">
              {group.label}
            </h2>
          ) : null}
          {group.label && collapsed ? (
            <span className="bg-border mx-2.5 mb-1 h-px" aria-hidden="true" />
          ) : null}

          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <NavRow
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function NavRow({
  item,
  pathname,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { hasPermission, isLoading } = useAuth();
  const active = isActiveHref(pathname, item);
  const hasChildren = Boolean(item.children?.length);

  // A parent with children starts expanded when one of its children is active —
  // otherwise landing on /settings/storage would show a collapsed Settings group.
  const [expanded, setExpanded] = useState(active);

  const children = (item.children ?? []).filter(
    (child) => isLoading || !child.permission || hasPermission(child.permission),
  );

  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium",
        "transition-colors duration-150",
        "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        active
          ? "bg-primary-soft text-primary-soft-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      {/* Active state is carried by BOTH the fill and this rail — colour alone
          would fail WCAG 1.4.1 for the ~8% who can't distinguish the tint. */}
      {active ? (
        <span
          aria-hidden="true"
          className="bg-primary absolute inset-y-1 left-0 w-0.5 rounded-full"
        />
      ) : null}
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
    </Link>
  );

  return (
    <li>
      <div className={cn("flex items-center", !collapsed && hasChildren && "gap-0.5")}>
        <div className="min-w-0 flex-1">
          {collapsed ? (
            <Tooltip content={item.label} side="right">
              {link}
            </Tooltip>
          ) : (
            link
          )}
        </div>

        {hasChildren && !collapsed ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${item.label} section`}
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              "text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md",
              "hover:bg-muted hover:text-foreground transition-colors",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            )}
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-200",
                expanded && "rotate-90",
              )}
              aria-hidden="true"
            />
          </button>
        ) : null}
      </div>

      {hasChildren && expanded && !collapsed ? (
        <ul className="border-border mt-0.5 ml-4 flex flex-col gap-0.5 border-l pl-3">
          {children.map((child) => {
            const childActive = pathname === child.href;
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  onClick={onNavigate}
                  aria-current={childActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm",
                    "transition-colors duration-150",
                    "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                    childActive
                      ? "text-foreground bg-muted font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                  )}
                >
                  <span className="truncate">{child.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
