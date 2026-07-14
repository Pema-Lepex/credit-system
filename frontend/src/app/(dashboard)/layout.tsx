import type { ReactNode } from "react";

import { DashboardShell } from "@/components/layout/dashboard-shell";

/**
 * Route-group layout for every authenticated page.
 *
 * A Server Component that renders one client boundary (DashboardShell). Because
 * `children` is passed as a prop rather than imported, every page below stays a
 * Server Component unless it opts in itself.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
