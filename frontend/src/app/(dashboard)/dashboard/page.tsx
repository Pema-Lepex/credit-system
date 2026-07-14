import type { Metadata } from "next";

import { DashboardView } from "@/features/dashboard/components/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * A Server Component that renders one client boundary. The dashboard is entirely
 * live data behind an in-memory access token, so there is nothing useful to
 * pre-render — but keeping the route server-side means the metadata and the shell
 * still come from the server.
 */
export default function Page() {
  return <DashboardView />;
}
