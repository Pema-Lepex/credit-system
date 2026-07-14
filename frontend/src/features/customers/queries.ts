"use client";

/**
 * TanStack Query bindings for the customer domain.
 *
 * KEY SHAPE: ["customers", <kind>, …args]. Every mutation invalidates the
 * "customers" root, which sweeps lists, the detail record AND the score in one
 * call — a payment changes the aggregates on the customer row, so a surgical
 * invalidation of just the detail would leave a stale balance in the table
 * behind it.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
  type UseMutationResult,
} from "@tanstack/react-query";

import { gqlRequest } from "@/lib/graphql/client";
import type { ID } from "@/types";

import {
  CREATE_CUSTOMER_MUTATION,
  CUSTOMERS_QUERY,
  CUSTOMER_CREDITS_QUERY,
  CUSTOMER_PAYMENTS_QUERY,
  CUSTOMER_QUERY,
  CUSTOMER_SCORE_QUERY,
  DELETE_CUSTOMER_MUTATION,
  UPDATE_CUSTOMER_MUTATION,
  type CreateCustomerResult,
  type CustomerCreditsResult,
  type CustomerFilterInput,
  type CustomerInput,
  type CustomerPaymentsResult,
  type CustomerRecord,
  type CustomerResult,
  type CustomerScoreResult,
  type CustomersResult,
  type DeleteCustomerResult,
  type PageInput,
  type SortInput,
  type UpdateCustomerResult,
} from "./api";

export const customerKeys = {
  all: ["customers"] as const,
  list: (filter: CustomerFilterInput, page: PageInput, sort: SortInput) =>
    ["customers", "list", filter, page, sort] as const,
  detail: (id: ID) => ["customers", "detail", id] as const,
  score: (id: ID) => ["customers", "score", id] as const,
  credits: (id: ID, page: PageInput) => ["customers", "credits", id, page] as const,
  payments: (id: ID, page: PageInput) => ["customers", "payments", id, page] as const,
};

export function useCustomers(filter: CustomerFilterInput, page: PageInput, sort: SortInput) {
  return useQuery({
    queryKey: customerKeys.list(filter, page, sort),
    queryFn: () =>
      gqlRequest<CustomersResult>(CUSTOMERS_QUERY, { filter, page, sort }).then(
        (data) => data.customers,
      ),
    // Paging without this flashes a skeleton over a table the user is reading.
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: ID) {
  return useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: () => gqlRequest<CustomerResult>(CUSTOMER_QUERY, { id }).then((d) => d.customer),
    enabled: Boolean(id),
  });
}

export function useCustomerScore(id: ID) {
  return useQuery({
    queryKey: customerKeys.score(id),
    queryFn: () =>
      gqlRequest<CustomerScoreResult>(CUSTOMER_SCORE_QUERY, { id }).then((d) => d.customerScore),
    enabled: Boolean(id),
  });
}

export function useCustomerCredits(id: ID, page: PageInput) {
  return useQuery({
    queryKey: customerKeys.credits(id, page),
    queryFn: () =>
      gqlRequest<CustomerCreditsResult>(CUSTOMER_CREDITS_QUERY, {
        filter: { customerId: id },
        page,
        sort: { field: "due_date", desc: true },
      }).then((d) => d.credits),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });
}

export function useCustomerPayments(id: ID, page: PageInput) {
  return useQuery({
    queryKey: customerKeys.payments(id, page),
    queryFn: () =>
      gqlRequest<CustomerPaymentsResult>(CUSTOMER_PAYMENTS_QUERY, {
        filter: { customerId: id, includeVoided: true },
        page,
        sort: { field: "paid_at", desc: true },
      }).then((d) => d.payments),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });
}

export function useCreateCustomer(): UseMutationResult<CustomerRecord, unknown, CustomerInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerInput) =>
      gqlRequest<CreateCustomerResult>(CREATE_CUSTOMER_MUTATION, { input }).then(
        (d) => d.createCustomer,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

export function useUpdateCustomer(
  id: ID,
): UseMutationResult<CustomerRecord, unknown, CustomerInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerInput) =>
      gqlRequest<UpdateCustomerResult>(UPDATE_CUSTOMER_MUTATION, { id, input }).then(
        (d) => d.updateCustomer,
      ),
    onSuccess: (customer) => {
      queryClient.setQueryData(customerKeys.detail(id), customer);
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

/**
 * Deletion is REFUSED by the server while the customer has open credits — it
 * throws CONFLICT with a message naming the count and the total owed. That is not
 * an error to swallow; the caller surfaces it verbatim.
 */
export function useDeleteCustomer(): UseMutationResult<
  DeleteCustomerResult["deleteCustomer"],
  unknown,
  ID
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: ID) =>
      gqlRequest<DeleteCustomerResult>(DELETE_CUSTOMER_MUTATION, { id }).then(
        (d) => d.deleteCustomer,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}
