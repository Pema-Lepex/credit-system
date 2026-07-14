"use client";

/**
 * Data retention: `retentionPreview`, `archiveBatches`, `postponeDeletion`,
 * `restoreArchive`.
 *
 * HONESTY NOTE — `retentionPreview` answers "what would the NEXT sweep archive
 * under the policy that is CURRENTLY SAVED". It takes no policy argument, so the
 * UI cannot show "switching to 30 days would archive 312 records" for an unsaved
 * choice without inventing the number. It does not invent it: the preview is
 * labelled with the policy it belongs to, and a pending change says so.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { gqlRequest } from "@/lib/graphql/client";
import type { ArchiveState, ID, ISODateTime, RetentionPolicy } from "@/types";
import type { PageInfo } from "./users";

export interface RetentionPreview {
  credits: number;
  payments: number;
  records: number;
  policy: RetentionPolicy;
}

export interface ArchiveBatch {
  id: ID;
  state: ArchiveState;
  creditCount: number;
  paymentCount: number;
  recordCount: number;
  storageBytes: number;
  retentionPolicy: string;
  deleteScheduledFor: ISODateTime;
  daysUntilDeletion: number;
  /** Days-before-deletion at which a warning email went out, e.g. [30, 7]. */
  warningsSent: number[];
  postponedCount: number;
  exportId: ID | null;
  canRestore: boolean;
  createdAt: ISODateTime;
}

export interface ArchiveBatchPage {
  items: ArchiveBatch[];
  pageInfo: PageInfo;
}

const RETENTION_PREVIEW_QUERY = /* GraphQL */ `
  query RetentionPreview {
    retentionPreview {
      credits
      payments
      records
      policy
    }
  }
`;

const ARCHIVE_BATCH_FIELDS = /* GraphQL */ `
  fragment ArchiveBatchFields on ArchiveBatchType {
    id
    state
    creditCount
    paymentCount
    recordCount
    storageBytes
    retentionPolicy
    deleteScheduledFor
    daysUntilDeletion
    warningsSent
    postponedCount
    exportId
    canRestore
    createdAt
  }
`;

const ARCHIVE_BATCHES_QUERY = /* GraphQL */ `
  ${ARCHIVE_BATCH_FIELDS}
  query ArchiveBatches($page: PageInput) {
    archiveBatches(page: $page) {
      items {
        ...ArchiveBatchFields
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

const POSTPONE_DELETION_MUTATION = /* GraphQL */ `
  ${ARCHIVE_BATCH_FIELDS}
  mutation PostponeDeletion($batchId: ID!, $days: Int!) {
    postponeDeletion(batchId: $batchId, days: $days) {
      ...ArchiveBatchFields
    }
  }
`;

const RESTORE_ARCHIVE_MUTATION = /* GraphQL */ `
  ${ARCHIVE_BATCH_FIELDS}
  mutation RestoreArchive($batchId: ID!) {
    restoreArchive(batchId: $batchId) {
      ...ArchiveBatchFields
    }
  }
`;

export const retentionKeys = {
  all: ["retention"] as const,
  preview: () => ["retention", "preview"] as const,
  batches: (page: number) => ["retention", "batches", page] as const,
};

export function useRetentionPreview(): UseQueryResult<RetentionPreview> {
  return useQuery({
    queryKey: retentionKeys.preview(),
    queryFn: async () => {
      const data = await gqlRequest<{ retentionPreview: RetentionPreview }>(
        RETENTION_PREVIEW_QUERY,
      );
      return data.retentionPreview;
    },
  });
}

export function useArchiveBatches(page: number): UseQueryResult<ArchiveBatchPage> {
  return useQuery({
    queryKey: retentionKeys.batches(page),
    queryFn: async () => {
      const data = await gqlRequest<
        { archiveBatches: ArchiveBatchPage },
        { page: { page: number; limit: number } }
      >(ARCHIVE_BATCHES_QUERY, { page: { page, limit: 10 } });
      return data.archiveBatches;
    },
    placeholderData: (previous) => previous,
  });
}

function useInvalidateRetention() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: retentionKeys.all });
    // A restore puts credits and payments back into the active lists.
    void queryClient.invalidateQueries({ queryKey: ["credits"] });
    void queryClient.invalidateQueries({ queryKey: ["payments"] });
  };
}

export function usePostponeDeletion() {
  const invalidate = useInvalidateRetention();
  return useMutation({
    mutationFn: async ({ batchId, days }: { batchId: ID; days: number }) => {
      const data = await gqlRequest<
        { postponeDeletion: ArchiveBatch },
        { batchId: ID; days: number }
      >(POSTPONE_DELETION_MUTATION, { batchId, days });
      return data.postponeDeletion;
    },
    onSuccess: invalidate,
  });
}

export function useRestoreArchive() {
  const invalidate = useInvalidateRetention();
  return useMutation({
    mutationFn: async (batchId: ID) => {
      const data = await gqlRequest<{ restoreArchive: ArchiveBatch }, { batchId: ID }>(
        RESTORE_ARCHIVE_MUTATION,
        { batchId },
      );
      return data.restoreArchive;
    },
    onSuccess: invalidate,
  });
}

export const ARCHIVE_STATE_LABELS: Record<ArchiveState, string> = {
  ARCHIVED: "Archived",
  PENDING_DELETION: "Deletion scheduled",
  POSTPONED: "Postponed",
  RESTORED: "Restored",
  DELETED: "Deleted",
};

export const RETENTION_POLICY_LABELS: Record<RetentionPolicy, string> = {
  DAYS_30: "30 days",
  DAYS_60: "60 days",
  DAYS_90: "90 days",
  NEVER: "Keep forever",
};
