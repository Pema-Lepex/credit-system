import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/layout/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/** Reachable signed in or out (see middleware OPEN_ROUTES). */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-border flex items-center justify-between border-b px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:outline-none"
        >
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12 sm:px-6">{children}</main>
    </div>
  );
}
