"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { toast } from "@/components/ui";
import { parseApiError } from "@/features/credits/lib/errors";
import { expenseKeys } from "@/features/expenses/queries";
import {
  CREATE_VENDOR_MUTATION,
  DELETE_VENDOR_MUTATION,
  UPDATE_VENDOR_MUTATION,
  VENDORS_QUERY,
  vendorKeys,
  type VendorInput,
  type VendorRow,
  type VendorsQueryResult,
} from "@/features/vendors/queries";
import { gqlRequest } from "@/lib/graphql/client";
import type { ID } from "@/types";

export function useVendors(options?: {
  search?: string;
  isActive?: boolean | null;
  page?: number;
}) {
  const search = options?.search ?? "";
  const isActive = options?.isActive ?? null;
  const page = options?.page ?? 1;

  return useQuery({
    queryKey: vendorKeys.list(search, isActive, page),
    queryFn: () =>
      gqlRequest<VendorsQueryResult, Record<string, unknown>>(VENDORS_QUERY, {
        search: search.trim() || null,
        isActive,
        page: { page, limit: 50 },
      }),
    placeholderData: keepPreviousData,
    select: (data) => data.vendors,
  });
}

/**
 * A vendor's name is snapshotted onto every expense at recording time, so changing
 * one never rewrites history — but the expense LIST still shows the live link, and
 * the pickers cache the names. Bust both.
 */
function useInvalidateVendorWrites() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: vendorKeys.all });
    void queryClient.invalidateQueries({ queryKey: expenseKeys.all });
  };
}

export function useCreateVendor() {
  const invalidate = useInvalidateVendorWrites();
  return useMutation({
    mutationFn: (input: VendorInput) =>
      gqlRequest<{ createVendor: VendorRow }, { input: VendorInput }>(CREATE_VENDOR_MUTATION, {
        input,
      }).then((data) => data.createVendor),
    onSuccess: (vendor) => {
      invalidate();
      toast.success(`Supplier "${vendor.name}" added`);
    },
    // Not toasted: a duplicate name comes back with field="name" and belongs on
    // the form, where the user is already looking.
  });
}

export function useUpdateVendor() {
  const invalidate = useInvalidateVendorWrites();
  return useMutation({
    mutationFn: ({ id, input }: { id: ID; input: VendorInput }) =>
      gqlRequest<{ updateVendor: VendorRow }, { id: ID; input: VendorInput }>(
        UPDATE_VENDOR_MUTATION,
        { id, input },
      ).then((data) => data.updateVendor),
    onSuccess: () => {
      invalidate();
      toast.success("Supplier updated");
    },
  });
}

export function useDeleteVendor() {
  const invalidate = useInvalidateVendorWrites();
  return useMutation({
    mutationFn: (id: ID) =>
      gqlRequest<{ deleteVendor: Pick<VendorRow, "id" | "name"> }, { id: ID }>(
        DELETE_VENDOR_MUTATION,
        { id },
      ).then((data) => data.deleteVendor),
    onSuccess: (vendor) => {
      invalidate();
      toast.success(`Supplier "${vendor.name}" removed`, {
        description: "Past expenses keep their name, so your records stay readable.",
      });
    },
    onError: (error) => {
      toast.error("Could not remove the supplier", {
        description: parseApiError(error).message,
      });
    },
  });
}
