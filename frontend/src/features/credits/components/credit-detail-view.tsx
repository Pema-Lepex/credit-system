"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  Download,
  FileText,
  ImageIcon,
  Pencil,
  Receipt,
  RefreshCw,
  Send,
  Trash2,
  User,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageHeader } from "@/components/layout/page-header";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
  Skeleton,
  buttonVariants,
  toast,
} from "@/components/ui";
import {
  CancelCreditDialog,
  DeleteCreditDialog,
} from "@/features/credits/components/credit-danger-dialogs";
import { CreditItemsTable } from "@/features/credits/components/credit-items-table";
import { PaymentTimeline } from "@/features/credits/components/payment-timeline";
import { CreditStatusBadge, DueDateBadge } from "@/features/credits/components/status-badges";
import { useCredit, usePaymentHistory } from "@/features/credits/hooks/use-credit";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import { useSendReminder } from "@/features/credits/hooks/use-credit-mutations";
import { WhatsAppReminderButton } from "@/features/credits/components/whatsapp-reminder-button";
import { parseApiError } from "@/features/credits/lib/errors";
import { toCents } from "@/features/credits/lib/money";
import { downloadInvoicePdf } from "@/features/credits/lib/rest";
import { creditKeys, type CreditDetail } from "@/features/credits/queries";
import { RecordPaymentDialog } from "@/features/payments/components/record-payment-dialog";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn, formatDate } from "@/lib/utils";
import type { ID } from "@/types";

export function CreditDetailView({ creditId }: { creditId: ID }) {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();

  const credit = useCredit(creditId);
  const history = usePaymentHistory(creditId);
  const sendReminder = useSendReminder();

  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  if (credit.isPending) return <DetailSkeleton />;

  if (credit.isError) {
    return (
      <div className="space-y-6">
        <BackLink />
        <Alert variant="destructive" title="Could not load this credit">
          <p>{parseApiError(credit.error).message}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            leftIcon={<RefreshCw />}
            isLoading={credit.isFetching}
            onClick={() => void credit.refetch()}
          >
            Try again
          </Button>
        </Alert>
      </div>
    );
  }

  const data = credit.data;
  const owesMoney = toCents(data.remainingAmount) > BigInt(0);
  const isCancelled = data.status === "CANCELLED";
  const isPaid = data.status === "PAID";

  const canPay = hasPermission("payment:write") && owesMoney && !isCancelled;
  const canRemind = hasPermission("reminder:send") && owesMoney && !isCancelled;
  const canEdit = hasPermission("credit:write") && !isCancelled;
  const canCancel = hasPermission("credit:write") && !isCancelled && !isPaid;
  // The server refuses a delete once a payment exists (cancel it instead, so the
  // ledger survives) — so we only offer it while the credit is still untouched.
  const canDelete =
    hasPermission("credit:delete") && toCents(data.amountPaid) === BigInt(0);

  const download = async () => {
    setIsDownloading(true);
    try {
      await downloadInvoicePdf(data.id, data.number);
    } catch (error) {
      toast.error("Could not download the invoice", {
        description: parseApiError(error).message,
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const refetchAll = () => {
    void queryClient.invalidateQueries({ queryKey: creditKeys.detail(creditId) });
    void queryClient.invalidateQueries({ queryKey: creditKeys.paymentHistory(creditId) });
  };

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={data.number}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <CreditStatusBadge status={data.status} />
            <DueDateBadge dueDate={data.dueDate} status={data.status} />
            <span className="text-muted-foreground text-sm">
              Issued {formatDate(data.issuedDate)} · Due {formatDate(data.dueDate)}
            </span>
          </span>
        }
        actions={
          <>
            {canPay ? (
              <Button leftIcon={<Receipt />} onClick={() => setPayOpen(true)}>
                Record payment
              </Button>
            ) : null}

            {canRemind ? (
              <>
                <Button
                  variant="outline"
                  leftIcon={<Send />}
                  isLoading={sendReminder.isPending}
                  onClick={() => sendReminder.mutate(data.id)}
                >
                  Send reminder
                </Button>
                {/* The manual channel, sitting next to the automatic one. It needs no
                    mail provider, so it keeps working when email does not. */}
                <WhatsAppReminderButton creditId={data.id} size="md" />
              </>
            ) : null}

            <Button
              variant="outline"
              leftIcon={<Download />}
              isLoading={isDownloading}
              onClick={() => void download()}
            >
              Invoice
            </Button>

            {canEdit ? (
              <Link
                href={`/credits/${data.id}/edit`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <Pencil aria-hidden="true" className="size-4" />
                Edit
              </Link>
            ) : null}

            {canCancel ? (
              <Button variant="ghost" leftIcon={<Ban />} onClick={() => setCancelOpen(true)}>
                Cancel
              </Button>
            ) : null}

            {canDelete ? (
              <Button
                variant="ghost"
                leftIcon={<Trash2 />}
                onClick={() => setDeleteOpen(true)}
                className="text-destructive-soft-foreground hover:bg-destructive-soft"
              >
                Delete
              </Button>
            ) : null}
          </>
        }
      />

      {isCancelled ? (
        <Alert variant="neutral" title="This credit is cancelled">
          It no longer counts towards what the customer owes, and no reminders will be sent for
          it. It stays on the books so the history stays honest.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent>
              <CreditItemsTable items={data.items} />
              <TotalsBlock credit={data} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Payment history</CardTitle>
            </CardHeader>
            <CardContent>
              {/* paymentHistory, not credit.payments: the history endpoint is the one
                  that includes VOIDED payments, and a ledger that hides its
                  reversals is not a ledger. */}
              <PaymentTimeline
                payments={history.data ?? []}
                isLoading={history.isPending}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <CustomerCard credit={data} />

          {data.notes ? (
            <Card>
              <CardHeader className="pb-4">
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-wrap">
                  {data.notes}
                </p>
              </CardContent>
            </Card>
          ) : null}

          <AttachmentsCard credit={data} />
        </div>
      </div>

      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        credit={{
          id: data.id,
          number: data.number,
          remainingAmount: data.remainingAmount,
          customerName: data.customer?.name,
        }}
        onRecorded={refetchAll}
      />

      <CancelCreditDialog open={cancelOpen} onOpenChange={setCancelOpen} credit={data} />
      <DeleteCreditDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        credit={data}
        // The page we are on no longer exists. Go back to the list rather than
        // render a 404 for a record the user just removed on purpose.
        onDeleted={() => router.replace("/credits")}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/credits"
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2")}
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      All credits
    </Link>
  );
}

/**
 * The money, in the order an invoice reads it. Every one of these numbers is the
 * SERVER's — nothing here is summed in the browser, because the server already did
 * it in integer minor units and any second opinion would eventually disagree.
 */
function TotalsBlock({ credit }: { credit: CreditDetail }) {
  const money = useMoney();
  const rows: Array<{ label: string; value: string; muted?: boolean }> = [
    { label: "Subtotal", value: money.format(credit.subtotal), muted: true },
    {
      label: credit.discountPercentage
        ? `Discount (${credit.discountPercentage}%)`
        : "Discount",
      value: `−${money.format(credit.discountAmount)}`,
      muted: true,
    },
    {
      label: credit.taxPercentage ? `Tax (${credit.taxPercentage}%)` : "Tax",
      value: money.format(credit.taxAmount),
      muted: true,
    },
  ];

  return (
    <div className="mt-6 flex justify-end">
      <dl className="w-full max-w-xs space-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-foreground tabular">{row.value}</dd>
          </div>
        ))}

        <Separator className="my-2" />

        <div className="flex items-center justify-between gap-4">
          <dt className="text-foreground font-semibold">Grand total</dt>
          <dd className="text-foreground tabular font-semibold">
            {money.format(credit.grandTotal)}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Paid</dt>
          <dd className="text-success-soft-foreground tabular">
            {money.format(credit.amountPaid)}
          </dd>
        </div>

        <div className="bg-muted/60 -mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-2">
          <dt className="text-foreground font-semibold">Remaining</dt>
          <dd className="text-foreground tabular text-base font-semibold">
            {money.format(credit.remainingAmount)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function CustomerCard({ credit }: { credit: CreditDetail }) {
  const money = useMoney();
  const customer = credit.customer;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle>Customer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {customer ? (
          <>
            <Link
              href={`/customers/${customer.id}`}
              className="focus-visible:ring-ring hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <span
                aria-hidden="true"
                className="bg-primary-soft text-primary-soft-foreground flex size-9 shrink-0 items-center justify-center rounded-full"
              >
                <User className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="text-foreground block truncate font-medium">
                  {customer.name}
                </span>
                <span className="text-muted-foreground block truncate text-xs tabular">
                  {customer.code}
                  {customer.phone ? ` · ${customer.phone}` : ""}
                </span>
              </span>
            </Link>

            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">This credit</dt>
                <dd className="text-foreground tabular">{money.format(credit.grandTotal)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Still owed here</dt>
                <dd className="text-foreground tabular font-medium">
                  {money.format(credit.remainingAmount)}
                </dd>
              </div>
              {credit.reminderDate ? (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Reminder</dt>
                  <dd className="text-foreground tabular">{formatDate(credit.reminderDate)}</dd>
                </div>
              ) : null}
            </dl>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">This credit has no customer attached.</p>
        )}
      </CardContent>
    </Card>
  );
}

function AttachmentsCard({ credit }: { credit: CreditDetail }) {
  const hasPhotos = credit.photoUrls.length > 0;
  const hasInvoice = Boolean(credit.invoiceUrl);
  if (!hasPhotos && !hasInvoice) return null;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle>Attachments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasPhotos ? (
          <div className="space-y-2">
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
              <ImageIcon aria-hidden="true" className="size-3.5" />
              Photos
              <Badge size="sm" variant="neutral">
                {credit.photoUrls.length}
              </Badge>
            </p>

            <ul className="flex flex-wrap gap-2">
              {credit.photoUrls.map((url, index) => (
                <li key={url}>
                  {/* Opens the full-size file. `rel="noreferrer"` because the target
                      is a raw asset URL and needs nothing from this page. */}
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-visible:ring-ring border-border block size-20 overflow-hidden rounded-lg border focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Image
                      src={url}
                      alt={`Credit photo ${index + 1}`}
                      width={80}
                      height={80}
                      className="size-full object-cover transition-transform hover:scale-105"
                      unoptimized
                    />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {credit.invoiceUrl ? (
          <a
            href={credit.invoiceUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
          >
            <FileText aria-hidden="true" className="size-4" />
            Open the attached invoice
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading credit</span>
      <Skeleton className="h-8 w-28" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}
