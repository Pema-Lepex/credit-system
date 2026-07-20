"use client";

/**
 * The audit trail: who created, updated, deleted, restored or purged what — with
 * the field-level before/after diff the backend records on every mutation.
 *
 * Read-only and admin-gated (`audit:read`). The log is append-only on the server;
 * there is no mutation here by design.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { gqlRequest } from "@/lib/graphql/client";
import type { AuditAction, ID, ISODate, ISODateTime } from "@/types";
import type { PageInfo } from "./users";

/** `changes` is a {field: [before, after]} diff. Values are already JSON-safe. */
export type AuditChanges = Record<string, [unknown, unknown]>;

export interface AuditLogRow {
  id: ID;
  action: AuditAction;
  entityType: string;
  entityId: ID | null;
  summary: string;
  changes: AuditChanges;
  actorLabel: string;
  createdAt: ISODateTime;
}

export interface AuditLogPage {
  items: AuditLogRow[];
  pageInfo: PageInfo;
}

export interface AuditLogFilters {
  action?: AuditAction | null;
  entityType?: string | null;
  search?: string | null;
  /**
   * Local calendar dates. The server widens them to the business's own day
   * boundaries in UTC — `createdAt` is an instant, so a bare date comparison
   * would drop everything that happened after midnight on the end date.
   */
  dateFrom?: ISODate | null;
  dateTo?: ISODate | null;
}

const AUDIT_LOGS_QUERY = /* GraphQL */ `
  query AuditLogs(
    $page: PageInput
    $action: AuditAction
    $entityType: String
    $search: String
    $dateFrom: Date
    $dateTo: Date
  ) {
    auditLogs(
      page: $page
      action: $action
      entityType: $entityType
      search: $search
      dateFrom: $dateFrom
      dateTo: $dateTo
    ) {
      items {
        id
        action
        entityType
        entityId
        summary
        changes
        actorLabel
        createdAt
      }
      pageInfo {
        total
        page
        limit
        pages
        hasNext
        hasPrevious
      }
    }
  }
`;

export const auditKeys = {
  all: ["audit"] as const,
  list: (page: number, filters: AuditLogFilters) => ["audit", "list", page, filters] as const,
};

const PAGE_SIZE = 20;

export function useAuditLogs(
  page: number,
  filters: AuditLogFilters,
): UseQueryResult<AuditLogPage> {
  return useQuery({
    queryKey: auditKeys.list(page, filters),
    queryFn: async () => {
      const data = await gqlRequest<
        { auditLogs: AuditLogPage },
        {
          page: { page: number; limit: number };
          action: AuditAction | null;
          entityType: string | null;
          search: string | null;
          dateFrom: ISODate | null;
          dateTo: ISODate | null;
        }
      >(AUDIT_LOGS_QUERY, {
        page: { page, limit: PAGE_SIZE },
        action: filters.action ?? null,
        entityType: filters.entityType?.trim() || null,
        search: filters.search?.trim() || null,
        dateFrom: filters.dateFrom || null,
        dateTo: filters.dateTo || null,
      });
      return data.auditLogs;
    },
    placeholderData: (previous) => previous,
  });
}
