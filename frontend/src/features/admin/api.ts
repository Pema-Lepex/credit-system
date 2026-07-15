"use client";

/**
 * Super Admin data layer: store-owner stats, listing, detail, and the five approval
 * actions. Thin react-query wrappers over the admin GraphQL documents, matching the
 * pattern in features/settings/api/users.ts.
 *
 * Every mutation invalidates the stats, the lists AND the detail, because a single
 * approve/reject changes all three views at once (a card count, a table row, the
 * open detail page).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { gqlRequest } from "@/lib/graphql/client";
import type { AdminBusiness, AdminStats, ApprovalStatus, ID } from "@/types";
import {
  ACTIVATE_BUSINESS_MUTATION,
  ADMIN_BUSINESS_QUERY,
  ADMIN_BUSINESSES_QUERY,
  ADMIN_STATS_QUERY,
  APPROVE_BUSINESS_MUTATION,
  DELETE_BUSINESS_MUTATION,
  REJECT_BUSINESS_MUTATION,
  SUSPEND_BUSINESS_MUTATION,
} from "@/features/admin/queries";

export interface PageInfo {
  total: number;
  page: number;
  limit: number;
  pages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface AdminBusinessPage {
  items: AdminBusiness[];
  pageInfo: PageInfo;
}

export interface AdminBusinessesFilter {
  page: number;
  limit: number;
  status?: ApprovalStatus | "";
  search?: string;
}

export const adminKeys = {
  all: ["admin"] as const,
  stats: ["admin", "stats"] as const,
  lists: ["admin", "businesses"] as const,
  list: (filter: AdminBusinessesFilter) => ["admin", "businesses", "list", filter] as const,
  detail: (id: ID) => ["admin", "businesses", "detail", id] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export function useAdminStats(): UseQueryResult<AdminStats> {
  return useQuery({
    queryKey: adminKeys.stats,
    queryFn: async () => {
      const data = await gqlRequest<{ adminStats: AdminStats }>(ADMIN_STATS_QUERY);
      return data.adminStats;
    },
  });
}

export function useAdminBusinesses(
  filter: AdminBusinessesFilter,
): UseQueryResult<AdminBusinessPage> {
  return useQuery({
    queryKey: adminKeys.list(filter),
    queryFn: async () => {
      const data = await gqlRequest<
        { adminBusinesses: AdminBusinessPage },
        { page: { page: number; limit: number }; status: string | null; search: string | null }
      >(ADMIN_BUSINESSES_QUERY, {
        page: { page: filter.page, limit: filter.limit },
        status: filter.status ? filter.status : null,
        search: filter.search?.trim() ? filter.search.trim() : null,
      });
      return data.adminBusinesses;
    },
    placeholderData: (previous) => previous, // no table flicker while paging/filtering
  });
}

export function useAdminBusiness(id: ID): UseQueryResult<AdminBusiness> {
  return useQuery({
    queryKey: adminKeys.detail(id),
    queryFn: async () => {
      const data = await gqlRequest<{ adminBusiness: AdminBusiness }, { id: ID }>(
        ADMIN_BUSINESS_QUERY,
        { id },
      );
      return data.adminBusiness;
    },
    enabled: Boolean(id),
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
function useInvalidateAdmin() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: adminKeys.all });
}

export function useApproveBusiness() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (id: ID) => {
      const data = await gqlRequest<{ approveBusiness: AdminBusiness }, { id: ID }>(
        APPROVE_BUSINESS_MUTATION,
        { id },
      );
      return data.approveBusiness;
    },
    onSuccess: () => void invalidate(),
  });
}

export function useActivateBusiness() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (id: ID) => {
      const data = await gqlRequest<{ activateBusiness: AdminBusiness }, { id: ID }>(
        ACTIVATE_BUSINESS_MUTATION,
        { id },
      );
      return data.activateBusiness;
    },
    onSuccess: () => void invalidate(),
  });
}

export function useRejectBusiness() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: ID; reason: string }) => {
      const data = await gqlRequest<
        { rejectBusiness: AdminBusiness },
        { id: ID; reason: string }
      >(REJECT_BUSINESS_MUTATION, { id, reason });
      return data.rejectBusiness;
    },
    onSuccess: () => void invalidate(),
  });
}

export function useSuspendBusiness() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: ID; reason: string }) => {
      const data = await gqlRequest<
        { suspendBusiness: AdminBusiness },
        { id: ID; reason: string }
      >(SUSPEND_BUSINESS_MUTATION, { id, reason });
      return data.suspendBusiness;
    },
    onSuccess: () => void invalidate(),
  });
}

export function useDeleteBusiness() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: async (id: ID) => {
      const data = await gqlRequest<
        { deleteBusiness: { success: boolean; message: string } },
        { id: ID }
      >(DELETE_BUSINESS_MUTATION, { id });
      return data.deleteBusiness;
    },
    onSuccess: () => void invalidate(),
  });
}
