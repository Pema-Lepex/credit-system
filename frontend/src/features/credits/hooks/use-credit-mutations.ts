"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { catalogKeys } from "@/features/catalog/queries";
import { parseApiError } from "@/features/credits/lib/errors";
import {
  CANCEL_CREDIT_MUTATION,
  COMPOSE_WHATSAPP_REMINDER_MUTATION,
  CREATE_CREDIT_MUTATION,
  DELETE_CREDIT_MUTATION,
  SEND_REMINDER_MUTATION,
  UPDATE_CREDIT_MUTATION,
  creditKeys,
  type CreditCreateInput,
  type CreditUpdateInput,
  type WhatsAppLink,
} from "@/features/credits/queries";
import { paymentKeys } from "@/features/payments/queries";
import { dashboardKeys } from "@/features/dashboard/queries";
import { gqlRequest } from "@/lib/graphql/client";
import { toast } from "@/components/ui";
import type { ID } from "@/types";

interface CreditRef {
  id: ID;
  number: string;
}

/**
 * Everything a credit write can invalidate.
 *
 * A credit write moves money, and money is on the dashboard, in the payments
 * ledger and in the customer's outstanding balance. Invalidating only the credit
 * list would leave a stale "Total overdue" on the very screen the owner checks
 * first, which is worse than a spinner.
 *
 * IT ALSO MOVES STOCK. Writing a credit for a catalog product decrements that
 * product server-side (CreditService._decrement_stock), so a cached Products page
 * keeps showing the OLD count until something forces a refetch. That looked
 * exactly like "stock is not reducing" — the deduction had happened, the screen
 * just never asked again.
 */
function useInvalidateCreditWrites() {
  const queryClient = useQueryClient();

  return (creditId?: ID) => {
    void queryClient.invalidateQueries({ queryKey: creditKeys.lists() });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    void queryClient.invalidateQueries({ queryKey: paymentKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["customers"] });
    void queryClient.invalidateQueries({ queryKey: catalogKeys.products });
    if (creditId) {
      void queryClient.invalidateQueries({ queryKey: creditKeys.detail(creditId) });
      void queryClient.invalidateQueries({ queryKey: creditKeys.paymentHistory(creditId) });
    }
  };
}

export function useCreateCredit() {
  const invalidate = useInvalidateCreditWrites();

  return useMutation({
    mutationFn: (input: CreditCreateInput) =>
      gqlRequest<{ createCredit: CreditRef }, { input: CreditCreateInput }>(
        CREATE_CREDIT_MUTATION,
        { input },
      ).then((data) => data.createCredit),
    onSuccess: (credit) => {
      invalidate(credit.id);
      toast.success(`Credit ${credit.number} created`);
    },
    // No toast here: the form maps VALIDATION_ERROR onto the offending field, and a
    // duplicate toast for an error that is already inline is just noise. The form
    // toasts only what it cannot place.
  });
}

export function useUpdateCredit() {
  const invalidate = useInvalidateCreditWrites();

  return useMutation({
    mutationFn: ({ id, input }: { id: ID; input: CreditUpdateInput }) =>
      gqlRequest<{ updateCredit: CreditRef }, { id: ID; input: CreditUpdateInput }>(
        UPDATE_CREDIT_MUTATION,
        { id, input },
      ).then((data) => data.updateCredit),
    onSuccess: (credit) => {
      invalidate(credit.id);
      toast.success(`Credit ${credit.number} updated`);
    },
  });
}

export function useCancelCredit() {
  const invalidate = useInvalidateCreditWrites();

  return useMutation({
    mutationFn: ({ id, reason }: { id: ID; reason?: string | null }) =>
      gqlRequest<{ cancelCredit: { id: ID; status: string } }, { id: ID; reason: string | null }>(
        CANCEL_CREDIT_MUTATION,
        { id, reason: reason?.trim() || null },
      ).then((data) => data.cancelCredit),
    onSuccess: (credit) => {
      invalidate(credit.id);
      toast.success("Credit cancelled");
    },
    onError: (error) => {
      // "Refused once money has changed hands" — the user needs to read this one,
      // not a generic failure.
      toast.error("Could not cancel", { description: parseApiError(error).message });
    },
  });
}

export function useDeleteCredit() {
  const invalidate = useInvalidateCreditWrites();

  return useMutation({
    mutationFn: (id: ID) =>
      gqlRequest<{ deleteCredit: CreditRef }, { id: ID }>(DELETE_CREDIT_MUTATION, { id }).then(
        (data) => data.deleteCredit,
      ),
    onSuccess: (credit) => {
      invalidate(credit.id);
      toast.success(`Credit ${credit.number} deleted`);
    },
    onError: (error) => {
      toast.error("Could not delete", { description: parseApiError(error).message });
    },
  });
}

export function useSendReminder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (creditId: ID) =>
      gqlRequest<{ sendReminder: { id: ID; status: string } }, { creditId: ID }>(
        SEND_REMINDER_MUTATION,
        { creditId },
      ).then((data) => data.sendReminder),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Reminder queued", {
        description: "It will go out with the next delivery sweep.",
      });
    },
    onError: (error) => {
      toast.error("Could not send the reminder", {
        description: parseApiError(error).message,
      });
    },
  });
}

/**
 * Compose a WhatsApp reminder — returns a wa.me link, sends nothing.
 *
 * No success toast and no cache invalidation on purpose: nothing has happened yet.
 * The owner has only asked to *see* the message; the caller shows it to them, and
 * they decide whether to open WhatsApp and tap Send.
 *
 * The error path matters more than usual here — the common failure is a customer
 * whose phone has no country code, and the server's message names both the customer
 * and the fix, so it is surfaced verbatim.
 */
export function useComposeWhatsappReminder() {
  return useMutation({
    mutationFn: (creditId: ID) =>
      gqlRequest<{ composeWhatsappReminder: WhatsAppLink }, { creditId: ID }>(
        COMPOSE_WHATSAPP_REMINDER_MUTATION,
        { creditId },
      ).then((data) => data.composeWhatsappReminder),
    onError: (error) => {
      toast.error("Could not prepare the WhatsApp message", {
        description: parseApiError(error).message,
      });
    },
  });
}
