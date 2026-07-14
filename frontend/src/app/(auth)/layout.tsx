import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";

import { Logo } from "@/components/layout/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const HIGHLIGHTS = [
  "Track every credit, item and payment in one ledger",
  "Automatic reminders before a due date — for you and your customer",
  "Know exactly who owes what, today",
] as const;

/**
 * Split-screen auth chrome.
 *
 * Mobile-first: the brand panel is `hidden lg:flex`, so a phone gets the form at
 * full width with no scroll-past-the-marketing. On lg+ the panel takes the left
 * half. The mesh + hairline grid are pure CSS (see globals.css) — no image, no
 * request, no layout shift.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* ------------------------------------------------------- brand panel */}
      <aside className="border-border bg-card relative hidden flex-col justify-between overflow-hidden border-r p-10 lg:flex xl:p-14">
        <div className="mesh-gradient absolute inset-0" aria-hidden="true" />
        <div className="grid-pattern absolute inset-0 opacity-60" aria-hidden="true" />

        <div className="relative">
          <Logo />
        </div>

        <div className="relative max-w-md space-y-8">
          <div className="space-y-4">
            <h2 className="text-3xl leading-tight font-semibold tracking-tight text-balance xl:text-4xl">
              <span className="text-gradient">Stop chasing payments</span> from a notebook.
            </h2>
            <p className="text-muted-foreground leading-relaxed text-pretty">
              A credit ledger built for shops, cafés, pharmacies and anyone who lets good
              customers pay later.
            </p>
          </div>

          <ul className="space-y-3">
            {HIGHLIGHTS.map((line) => (
              <li key={line} className="text-foreground flex items-start gap-3 text-sm">
                <CheckCircle2
                  className="text-success-soft-foreground mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span className="leading-relaxed">{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-muted-foreground relative text-xs">
          © {new Date().getFullYear()} Credit Manager. All rights reserved.
        </p>
      </aside>

      {/* ------------------------------------------------------------- form */}
      <main className="relative flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-6">
          <span className="lg:invisible">
            <Logo />
          </span>
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center px-4 pt-2 pb-10 sm:px-6">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}
