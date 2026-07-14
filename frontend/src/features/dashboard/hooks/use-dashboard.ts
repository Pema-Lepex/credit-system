"use client";

import { useQuery } from "@tanstack/react-query";

import {
  DASHBOARD_QUERY,
  dashboardKeys,
  type DashboardQueryResult,
} from "@/features/dashboard/queries";
import { gqlRequest } from "@/lib/graphql/client";

export function useDashboard() {
  return useQuery({
    queryKey: dashboardKeys.all,
    queryFn: () => gqlRequest<DashboardQueryResult>(DASHBOARD_QUERY),
    // The owner opens this every morning and leaves it open. A minute is fresh
    // enough for a credit book and stops a tab-switch from hammering the API.
    staleTime: 60_000,
    select: (data) => data.dashboard,
  });
}
