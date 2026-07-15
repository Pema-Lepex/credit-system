"use client";

import { Suspense, type ReactNode } from "react";

import { Spinner } from "@/components/ui/spinner";
import { AdminShell } from "@/features/admin/components/admin-shell";

/**
 * Layout for the Super Admin panel (/admin/*).
 *
 * AdminShell reads the URL (usePathname/useSearchParams) to light the active nav
 * item, so it lives under a Suspense boundary — Next requires one around any
 * useSearchParams consumer or the route fails to prerender.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <Spinner size="lg" label="Loading the admin panel" />
        </div>
      }
    >
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
