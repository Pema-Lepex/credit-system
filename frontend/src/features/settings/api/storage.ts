"use client";

/**
 * `storageUsage` + `runMaintenance(operation)`.
 *
 * The operation names are NOT free text: the backend keeps a whitelist
 * (`_MAINTENANCE_OPS` in app/graphql/mutations.py) precisely because "run any
 * method you name" is not an API. MAINTENANCE_OPERATIONS below is a verbatim copy
 * of that whitelist — if it drifts, the mutation errors rather than misfires.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { gqlRequest } from "@/lib/graphql/client";

export interface StorageBreakdown {
  label: string;
  bytes: number;
  count: number;
}

export interface StorageUsage {
  databaseBytes: number;
  uploadsBytes: number;
  totalBytes: number;
  quotaBytes: number;
  percentUsed: number;
  overQuota: boolean;
  bytesSavedByCompression: number;
  breakdown: StorageBreakdown[];
  customerCount: number;
  creditCount: number;
  paymentCount: number;
  productCount: number;
  serviceCount: number;
  imageCount: number;
  exportCount: number;
}

export interface MaintenanceResult {
  operation: string;
  success: boolean;
  message: string;
  bytesFreed: number;
  rowsAffected: number;
}

const STORAGE_USAGE_QUERY = /* GraphQL */ `
  query StorageUsage {
    storageUsage {
      databaseBytes
      uploadsBytes
      totalBytes
      quotaBytes
      percentUsed
      overQuota
      bytesSavedByCompression
      breakdown {
        label
        bytes
        count
      }
      customerCount
      creditCount
      paymentCount
      productCount
      serviceCount
      imageCount
      exportCount
    }
  }
`;

const RUN_MAINTENANCE_MUTATION = /* GraphQL */ `
  mutation RunMaintenance($operation: String!) {
    runMaintenance(operation: $operation) {
      operation
      success
      message
      bytesFreed
      rowsAffected
    }
  }
`;

/** Verbatim from the backend whitelist. */
export const MAINTENANCE_OPERATIONS = [
  "clean_temp_files",
  "delete_expired_exports",
  "sweep_orphan_files",
  "vacuum_database",
  "analyze_database",
  "optimize_database",
  "check_integrity",
  "clean_old_logs",
] as const;

export type MaintenanceOperation = (typeof MAINTENANCE_OPERATIONS)[number];

export interface MaintenanceAction {
  operation: MaintenanceOperation;
  label: string;
  description: string;
  /** Deletes data or rewrites the database file — gets a confirm dialog. */
  destructive: boolean;
}

export const MAINTENANCE_ACTIONS: readonly MaintenanceAction[] = [
  {
    operation: "clean_temp_files",
    label: "Clean temp files",
    description: "Delete abandoned uploads and scratch files. Nothing you attached is touched.",
    destructive: true,
  },
  {
    operation: "delete_expired_exports",
    label: "Delete expired exports",
    description: "Remove export downloads that have already passed their 24-hour expiry.",
    destructive: true,
  },
  {
    operation: "sweep_orphan_files",
    label: "Sweep orphan files",
    description: "Delete uploaded files that no customer, credit or payment refers to any more.",
    destructive: true,
  },
  {
    operation: "vacuum_database",
    label: "Vacuum database",
    description: "Rebuild the database file to reclaim space left by deleted rows.",
    destructive: true,
  },
  {
    operation: "clean_old_logs",
    label: "Clean old logs",
    description: "Trim audit and email logs that have aged out of the retention window.",
    destructive: true,
  },
  {
    operation: "analyze_database",
    label: "Analyze",
    description: "Refresh query-planner statistics. Read-only; makes lists faster.",
    destructive: false,
  },
  {
    operation: "optimize_database",
    label: "Optimize",
    description: "Let the database tune its own indexes. Safe to run any time.",
    destructive: false,
  },
  {
    operation: "check_integrity",
    label: "Check integrity",
    description: "Verify the database is not corrupted. Read-only.",
    destructive: false,
  },
];

export const storageKeys = {
  all: ["storage"] as const,
  usage: () => ["storage", "usage"] as const,
};

export function useStorageUsage(): UseQueryResult<StorageUsage> {
  return useQuery({
    queryKey: storageKeys.usage(),
    queryFn: async () => {
      const data = await gqlRequest<{ storageUsage: StorageUsage }>(STORAGE_USAGE_QUERY);
      return data.storageUsage;
    },
  });
}

export function useRunMaintenance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (operation: MaintenanceOperation) => {
      const data = await gqlRequest<
        { runMaintenance: MaintenanceResult },
        { operation: string }
      >(RUN_MAINTENANCE_MUTATION, { operation });
      return data.runMaintenance;
    },
    onSuccess: () => {
      // Every operation moves the numbers on this page; several also delete exports.
      void queryClient.invalidateQueries({ queryKey: storageKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["exports"] });
    },
  });
}
