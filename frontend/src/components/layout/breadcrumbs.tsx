"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useMemo } from "react";

import { labelForHref } from "@/components/layout/nav-config";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  /** Override the derived trail — detail pages want the record's name, not its id. */
  items?: Crumb[];
  className?: string;
}

/**
 * Derived from the pathname by default. A raw id segment (32-char hex) is
 * rendered as a short code rather than a wall of hex — a detail page should pass
 * `items` with the real record name instead.
 */
export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  const pathname = usePathname();

  const crumbs = useMemo<Crumb[]>(() => {
    if (items) return items;

    const segments = pathname.split("/").filter(Boolean);
    return segments.map((segment, index) => {
      const href = `/${segments.slice(0, index + 1).join("/")}`;
      const isId = /^[0-9a-f]{16,32}$/i.test(segment);
      return {
        label: isId ? `#${segment.slice(0, 6)}` : labelForHref(href),
        href: index < segments.length - 1 ? href : undefined,
      };
    });
  }, [items, pathname]);

  if (crumbs.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex items-center gap-1.5 text-sm">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.label}-${index}`}>
              <li className="min-w-0">
                {crumb.href && !isLast ? (
                  <Link
                    href={crumb.href}
                    className="text-muted-foreground hover:text-foreground focus-visible:ring-ring truncate rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  // aria-current="page" is what tells AT which crumb is *here*.
                  <span aria-current="page" className="text-foreground truncate font-medium">
                    {crumb.label}
                  </span>
                )}
              </li>
              {!isLast ? (
                <li aria-hidden="true" className="text-muted-foreground/60">
                  <ChevronRight className="size-3.5" />
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
