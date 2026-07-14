"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui";
import { SETTINGS_SECTIONS } from "@/features/settings/components/settings-nav";
import { useAuth } from "@/lib/auth/AuthProvider";

/**
 * The /settings landing page: one card per section.
 *
 * Sections the user's role cannot reach are not shown at all — a card that leads
 * to a "you don't have access" page is a wasted click.
 */
export function SettingsIndex() {
  const { hasPermission } = useAuth();

  const sections = SETTINGS_SECTIONS.filter(
    (section) => !section.permission || hasPermission(section.permission),
  );

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sections.map((section) => (
        <li key={section.href}>
          <Card interactive className="h-full">
            <CardContent className="pt-6">
              <Link
                href={section.href}
                className="focus-visible:ring-ring flex h-full flex-col gap-2 rounded-md focus-visible:ring-2 focus-visible:outline-none"
              >
                <span className="bg-primary-soft text-primary-soft-foreground flex size-9 items-center justify-center rounded-lg">
                  <section.icon className="size-4" aria-hidden="true" />
                </span>

                <span className="text-foreground mt-1 flex items-center gap-1.5 text-sm font-semibold">
                  {section.label}
                  <ArrowRight
                    className="text-muted-foreground size-3.5 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </span>

                <span className="text-muted-foreground text-sm leading-relaxed">
                  {section.description}
                </span>
              </Link>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
