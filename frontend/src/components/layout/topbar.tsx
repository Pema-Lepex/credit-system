"use client";

import { Menu, Search } from "lucide-react";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { NotificationBell } from "@/components/layout/notification-bell";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";

export interface TopbarProps {
  onOpenMobileNav: () => void;
  onOpenSearch: () => void;
  unreadCount?: number;
}

export function Topbar({ onOpenMobileNav, onOpenSearch, unreadCount }: TopbarProps) {
  return (
    // `glass` + sticky: the content scrolls under a frosted bar. This is one of the
    // three places glass is allowed — it earns its keep by keeping the bar legible
    // over arbitrary content.
    <header className="glass sticky top-0 z-30 border-x-0 border-t-0">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open navigation menu"
          onClick={onOpenMobileNav}
          className="lg:hidden"
        >
          <Menu />
        </Button>

        <Breadcrumbs className="hidden md:block" />

        <div className="flex flex-1 items-center justify-end gap-1 sm:gap-2">
          {/* A button, not an input: it opens the palette. Styling it as a search
              field is a deliberate affordance — it's what users expect to click. */}
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Search — press Command K"
            aria-keyshortcuts="Meta+K Control+K"
            className={cn(
              "group border-border bg-background flex h-9 items-center gap-2 rounded-md border px-3",
              "text-muted-foreground hover:border-foreground/20 hover:text-foreground text-sm transition-colors",
              "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
              "w-9 justify-center sm:w-56 sm:justify-start lg:w-72",
            )}
          >
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <span className="hidden flex-1 text-left sm:block">Search…</span>
            <kbd className="border-border bg-muted hidden shrink-0 items-center gap-0.5 rounded border px-1.5 py-0.5 font-sans text-[10px] font-medium sm:flex">
              <span className="text-xs">⌘</span>K
            </kbd>
          </button>

          <NotificationBell unreadCount={unreadCount} />
          <ThemeToggle />
          <div className="bg-border mx-1 h-5 w-px" aria-hidden="true" />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
