"use client";

/**
 * Chrome + guard for the Super Admin panel. Minimal and professional, per the spec:
 * a fixed sidebar on desktop, a Sheet drawer on mobile, and nothing tenant-specific.
 *
 * GUARD: this is a UX guard, not the security boundary. middleware.ts already
 * requires a session cookie for /admin, and every admin GraphQL call is SUPER_ADMIN-
 * only on the server. Here we simply avoid rendering the panel to the wrong person:
 * a signed-in non-super-admin is sent to their dashboard; an unauthenticated visitor
 * is bounced to /login by the transport layer.
 */

import {
  CheckCircle2,
  Clock,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldBan,
  ShieldX,
  Store,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useDisclosure } from "@/hooks/use-disclosure";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";

interface AdminNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** The `?status=` this item represents, if any. Absent = the "all" view. */
  status?: string;
  /** Match exactly (Dashboard), not by prefix. */
  exact?: boolean;
}

const NAV: AdminNavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard, exact: true },
  { label: "Store Owners", href: "/admin/users", icon: Store },
  { label: "Pending Approvals", href: "/admin/users?status=PENDING", icon: Clock, status: "PENDING" },
  { label: "Approved", href: "/admin/users?status=APPROVED", icon: CheckCircle2, status: "APPROVED" },
  { label: "Rejected", href: "/admin/users?status=REJECTED", icon: ShieldX, status: "REJECTED" },
  { label: "Suspended", href: "/admin/users?status=SUSPENDED", icon: ShieldBan, status: "SUSPENDED" },
  { label: "Settings", href: "/admin/settings", icon: Settings, exact: true },
];

function useIsActive() {
  const pathname = usePathname();
  const params = useSearchParams();
  const currentStatus = params.get("status");
  return (item: AdminNavItem): boolean => {
    if (item.exact) return pathname === item.href;
    if (!pathname.startsWith("/admin/users")) return false;
    // "Store Owners" (no status) is active only when no status filter is applied.
    if (!item.status) return !currentStatus;
    return currentStatus === item.status;
  };
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const isActive = useIsActive();
  return (
    <nav className="flex flex-col gap-1 p-3">
      {NAV.map((item) => {
        const active = isActive(item);
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              active
                ? "bg-primary-soft text-primary-soft-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarFooter() {
  const { user, logout } = useAuth();
  return (
    <div className="border-border space-y-3 border-t p-3">
      <div className="px-1">
        <p className="text-foreground truncate text-sm font-medium">Super Administrator</p>
        <p className="text-muted-foreground truncate text-xs">{user?.email}</p>
      </div>
      <Button
        variant="outline"
        fullWidth
        leftIcon={<LogOut />}
        onClick={() => void logout()}
      >
        Sign out
      </Button>
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();
  const router = useRouter();
  const mobileNav = useDisclosure();

  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  // A signed-in non-super-admin has no business here — send them to their app.
  useEffect(() => {
    if (!isLoading && isAuthenticated && !isSuperAdmin) router.replace("/dashboard");
  }, [isLoading, isAuthenticated, isSuperAdmin, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size="lg" label="Loading the admin panel" />
      </div>
    );
  }

  if (!isAuthenticated || !isSuperAdmin) {
    // Either the transport layer is redirecting to /login, or the effect above is
    // sending a non-admin to /dashboard. Show a neutral frame meanwhile.
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size="lg" label="Redirecting" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* -------------------------------------------------------------- rail */}
      <aside className="border-border bg-card fixed inset-y-0 left-0 z-40 hidden w-64 shrink-0 flex-col border-r lg:flex">
        <div className="border-border flex h-14 items-center border-b px-4">
          <Link href="/admin" className="focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:outline-none">
            <Logo />
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavLinks />
        </div>
        <SidebarFooter />
      </aside>

      {/* ---------------------------------------------------- mobile drawer */}
      <Sheet
        open={mobileNav.isOpen}
        onOpenChange={mobileNav.setOpen}
        side="left"
        title="Admin navigation"
        hideTitle
      >
        <div className="border-border flex h-14 items-center border-b px-4">
          <Logo />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            <NavLinks onNavigate={mobileNav.close} />
          </div>
          <SidebarFooter />
        </div>
      </Sheet>

      {/* -------------------------------------------------------------- main */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="border-border bg-card/80 sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              aria-label="Open navigation"
              onClick={mobileNav.open}
            >
              <Menu />
            </Button>
            <span className="text-sm font-semibold tracking-tight">Super Admin</span>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex-1">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
