"use client";

import {
  Ban,
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Receipt,
  Send,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from "@/components/ui";
import { useSendReminder } from "@/features/credits/hooks/use-credit-mutations";
import { parseApiError } from "@/features/credits/lib/errors";
import { downloadInvoicePdf } from "@/features/credits/lib/rest";
import { toCents } from "@/features/credits/lib/money";
import type { CreditListRow } from "@/features/credits/queries";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";

export interface CreditRowActionsProps {
  credit: CreditListRow;
  onRecordPayment: (credit: CreditListRow) => void;
  onCancel: (credit: CreditListRow) => void;
  onDelete: (credit: CreditListRow) => void;
  /** The detail page already IS the credit — it does not need a "View" item. */
  hideView?: boolean;
  className?: string;
}

/**
 * What you can do to a credit, filtered by permission AND by state.
 *
 * State matters as much as permission: "Record payment" on a cancelled credit is
 * an action the server will refuse, and offering it is a promise the app cannot
 * keep. Every item here is one the server would actually accept.
 */
export function CreditRowActions({
  credit,
  onRecordPayment,
  onCancel,
  onDelete,
  hideView,
  className,
}: CreditRowActionsProps) {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const sendReminder = useSendReminder();
  const [isDownloading, setIsDownloading] = useState(false);

  const isCancelled = credit.status === "CANCELLED";
  const isPaid = credit.status === "PAID";
  const owesMoney = toCents(credit.remainingAmount) > BigInt(0);

  const canRecordPayment = hasPermission("payment:write") && owesMoney && !isCancelled;
  const canRemind = hasPermission("reminder:send") && owesMoney && !isCancelled;
  const canEdit = hasPermission("credit:write") && !isCancelled;
  const canCancel = hasPermission("credit:write") && !isCancelled && !isPaid;
  const canDelete = hasPermission("credit:delete");

  const download = async () => {
    setIsDownloading(true);
    try {
      await downloadInvoicePdf(credit.id, credit.number);
    } catch (error) {
      toast.error("Could not download the invoice", {
        description: parseApiError(error).message,
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for credit ${credit.number}`}
        className={cn(
          "text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-8 items-center justify-center rounded-md transition-colors",
          "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          className,
        )}
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>

      <DropdownMenuContent>
        {!hideView ? (
          <DropdownMenuItem icon={<Eye />} onSelect={() => router.push(`/credits/${credit.id}`)}>
            View credit
          </DropdownMenuItem>
        ) : null}

        {canRecordPayment ? (
          <DropdownMenuItem icon={<Receipt />} onSelect={() => onRecordPayment(credit)}>
            Record payment
          </DropdownMenuItem>
        ) : null}

        {canRemind ? (
          <DropdownMenuItem
            icon={<Send />}
            disabled={sendReminder.isPending}
            onSelect={() => sendReminder.mutate(credit.id)}
          >
            Send reminder
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuItem
          icon={<Download />}
          disabled={isDownloading}
          onSelect={() => void download()}
        >
          Download invoice
        </DropdownMenuItem>

        {canEdit ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<Pencil />}
              onSelect={() => router.push(`/credits/${credit.id}/edit`)}
            >
              Edit
            </DropdownMenuItem>
          </>
        ) : null}

        {canCancel ? (
          <DropdownMenuItem icon={<Ban />} onSelect={() => onCancel(credit)}>
            Cancel credit
          </DropdownMenuItem>
        ) : null}

        {canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => onDelete(credit)}>
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
