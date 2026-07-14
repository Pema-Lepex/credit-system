"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { CommandPalette } from "@/components/layout/command-palette";
import { Logo } from "@/components/layout/logo";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { useDisclosure } from "@/hooks/use-disclosure";
import { useHotkey } from "@/hooks/use-hotkey";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "cms.sidebar_collapsed";

/**
 * The application chrome.
 *
 * Client, because it owns three pieces of interactive state (sidebar collapse,
 * mobile drawer, ⌘K palette). `children` is still whatever the route rendered —
 * a Server Component page passed through as a prop stays a Server Component.
 *
 * RESPONSIVE MODEL
 *   < lg : no rail at all; nav lives in a Sheet behind the hamburger.
 *   >= lg: fixed rail, 16rem expanded / 4.5rem collapsed (icons + tooltips).
 *   >= 2xl: content is capped at --container-content and centred, so an ultrawide
 *           monitor gets margins instead of a 3000px-wide table.
 */
export function DashboardShell({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const mobileNav = useDisclosure();
  const palette = useDisclosure();

  // Read the persisted preference AFTER mount — reading localStorage during
  // render would desync SSR markup from the client and blow up hydration.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  useHotkey("k", () => palette.toggle(), { meta: true, allowInInput: true });

  /**
   * Auth gate. middleware.ts already bounced anyone without a session cookie, but
   * the cookie is only a hint — this is where we wait for the real `me` result.
   * Rendering the shell to an unauthenticated user would flash their predecessor's
   * layout before the redirect lands.
   */
  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size="lg" label="Loading your workspace" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // The transport layer's endSession() has already issued the redirect; this is
    // just what the user sees for the frame in between.
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">Your session has ended.</p>
          <Button onClick={() => window.location.assign("/login")}>Sign in again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* First tab stop on every page — WCAG 2.4.1 Bypass Blocks. */}
      <a
        href="#main"
        className={cn(
          "sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100]",
          "focus:bg-primary focus:rounded-md focus:px-4 focus:py-2 focus:text-sm",
          "focus:text-primary-foreground focus:font-medium focus:shadow-lg",
        )}
      >
        Skip to main content
      </a>

      {/* ---------------------------------------------------------------- rail */}
      <aside
        aria-label="Sidebar"
        className={cn(
          "border-border bg-card fixed inset-y-0 left-0 z-40 hidden shrink-0 flex-col border-r lg:flex",
          "transition-[width] duration-200 ease-out",
          collapsed ? "w-[4.5rem]" : "w-64",
        )}
      >
        <div
          className={cn(
            "border-border flex h-14 shrink-0 items-center border-b px-3",
            collapsed ? "justify-center" : "justify-between",
          )}
        >
          <Link
            href="/dashboard"
            className="focus-visible:ring-ring min-w-0 rounded-md focus-visible:ring-2 focus-visible:outline-none"
          >
            <Logo showWordmark={!collapsed} />
          </Link>
          {!collapsed ? (
            <Tooltip content="Collapse sidebar" side="right">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Collapse sidebar"
                aria-expanded={!collapsed}
                onClick={toggleCollapsed}
              >
                <PanelLeftClose />
              </Button>
            </Tooltip>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav collapsed={collapsed} />
        </div>

        {collapsed ? (
          <div className="border-border flex shrink-0 items-center justify-center border-t p-3">
            <Tooltip content="Expand sidebar" side="right">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Expand sidebar"
                aria-expanded={!collapsed}
                onClick={toggleCollapsed}
              >
                <PanelLeftOpen />
              </Button>
            </Tooltip>
          </div>
        ) : null}
      </aside>

      {/* -------------------------------------------------------- mobile drawer */}
      <Sheet
        open={mobileNav.isOpen}
        onOpenChange={mobileNav.setOpen}
        side="left"
        title="Navigation"
        hideTitle
      >
        <div className="border-border flex h-14 items-center border-b px-4">
          <Logo />
        </div>
        <SidebarNav onNavigate={mobileNav.close} />
      </Sheet>

      {/* ---------------------------------------------------------------- main */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ease-out",
          collapsed ? "lg:pl-[4.5rem]" : "lg:pl-64",
        )}
      >
        <Topbar onOpenMobileNav={mobileNav.open} onOpenSearch={palette.open} />

        <main id="main" tabIndex={-1} className="flex-1 focus-visible:outline-none">
          <div className="content-container pb-safe px-4 py-6 sm:px-6 lg:py-8">{children}</div>
        </main>
      </div>

      {/* Placeholder search: navigation only. The feature agent passes `results`
          + `onQueryChange` wired to the real global-search query. */}
      <CommandPalette open={palette.isOpen} onOpenChange={palette.setOpen} />
    </div>
  );
}
