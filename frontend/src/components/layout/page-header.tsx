import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Primary/secondary CTAs. Right-aligned on desktop, full-width stack on mobile. */
  actions?: ReactNode;
  /** Filters, tabs, a search box — anything that sits under the title. */
  children?: ReactNode;
  className?: string;
}

/**
 * Every page's h1 lives here — exactly one per page, which is what lets a screen
 * reader user press "1" to jump to the page title.
 *
 * A Server Component: it holds no state. Actions are passed in as already-
 * rendered nodes, so a client-side <Button onClick> still works inside it.
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-foreground truncate text-xl font-semibold tracking-tight sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </header>
  );
}
