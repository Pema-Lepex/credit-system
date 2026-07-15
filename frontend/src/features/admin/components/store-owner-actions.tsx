"use client";

/**
 * Every super-admin action on one store owner, in one place: approve, reject,
 * suspend, re-activate, delete. Shared by the table (variant="menu", a dropdown) and
 * the detail page (variant="buttons", inline). Keeping the mutations + dialogs
 * together is what stops the two surfaces drifting apart.
 *
 * Which actions are offered depends on the current status:
 *   PENDING   -> Approve, Reject
 *   APPROVED  -> Suspend
 *   REJECTED  -> Approve (re-approve)
 *   SUSPENDED -> Activate (re-approve)
 * Delete (permanent, irreversible) and View are always available.
 */

import { CheckCircle2, Eye, MoreHorizontal, Play, ShieldBan, ShieldX, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  Button,
  ConfirmDialog,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FormField,
  Input,
  Textarea,
  toast,
} from "@/components/ui";
import {
  useActivateBusiness,
  useApproveBusiness,
  useDeleteBusiness,
  useRejectBusiness,
  useSuspendBusiness,
} from "@/features/admin/api";
import { GraphQLRequestError } from "@/lib/graphql/client";
import type { AdminBusiness } from "@/types";

type ReasonSheet = "reject" | "suspend" | null;
type Confirm = "approve" | "activate" | null;

export function StoreOwnerActions({
  business,
  variant = "menu",
  onDeleted,
}: {
  business: AdminBusiness;
  variant?: "menu" | "buttons";
  onDeleted?: () => void;
}) {
  const status = business.approvalStatus;
  const router = useRouter();

  const approve = useApproveBusiness();
  const activate = useActivateBusiness();
  const reject = useRejectBusiness();
  const suspend = useSuspendBusiness();
  const del = useDeleteBusiness();

  const [confirm, setConfirm] = useState<Confirm>(null);
  const [sheet, setSheet] = useState<ReasonSheet>(null);
  const [reason, setReason] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  const run = async (
    action: Promise<unknown>,
    successMessage: string,
    after?: () => void,
  ) => {
    try {
      await action;
      toast.success(successMessage);
      after?.();
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError ? error.message : "Something went wrong.",
      );
    }
  };

  const onApprove = () =>
    run(approve.mutateAsync(business.id), `${business.name} approved.`, () => setConfirm(null));
  const onActivate = () =>
    run(activate.mutateAsync(business.id), `${business.name} re-activated.`, () =>
      setConfirm(null),
    );
  const onReject = () =>
    run(reject.mutateAsync({ id: business.id, reason }), `${business.name} rejected.`, () => {
      setSheet(null);
      setReason("");
    });
  const onSuspend = () =>
    run(suspend.mutateAsync({ id: business.id, reason }), `${business.name} suspended.`, () => {
      setSheet(null);
      setReason("");
    });
  const onDelete = () =>
    run(del.mutateAsync(business.id), `${business.name} was permanently deleted.`, () => {
      setDeleteOpen(false);
      setDeleteText("");
      onDeleted?.();
    });

  const canApprove = status === "PENDING" || status === "REJECTED";
  const canSuspend = status === "APPROVED";
  const canActivate = status === "SUSPENDED";
  const canReject = status === "PENDING";
  // "Approve" for a fresh signup; "Activate" is the same underlying action for a
  // suspended shop — labelled by what the operator is actually doing.
  const reApproveIsActivate = status === "SUSPENDED";

  const openReason = (which: ReasonSheet) => {
    setReason("");
    setSheet(which);
  };
  const openConfirm = (which: Confirm) => setConfirm(which);

  // ---- shared dialogs ----------------------------------------------------
  const dialogs = (
    <>
      <ConfirmDialog
        open={confirm === "approve"}
        onOpenChange={() => setConfirm(null)}
        title={`Approve ${business.name}?`}
        description="The owner and their staff will get full access to the system immediately."
        confirmLabel="Approve"
        isLoading={approve.isPending}
        onConfirm={onApprove}
      />

      <ConfirmDialog
        open={confirm === "activate"}
        onOpenChange={() => setConfirm(null)}
        title={`Re-activate ${business.name}?`}
        description="Access is restored immediately and the account returns to Approved."
        confirmLabel="Activate"
        isLoading={activate.isPending}
        onConfirm={onActivate}
      />

      {/* Reject / Suspend share the reason form. */}
      <Dialog
        open={sheet !== null}
        onOpenChange={() => setSheet(null)}
        title={sheet === "reject" ? `Reject ${business.name}?` : `Suspend ${business.name}?`}
        description={
          sheet === "reject"
            ? "The owner can still sign in, but will only see this reason. Nothing else will work."
            : "Access is revoked immediately. The owner will see this reason after signing in."
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setSheet(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length === 0}
              isLoading={reject.isPending || suspend.isPending}
              onClick={sheet === "reject" ? onReject : onSuspend}
            >
              {sheet === "reject" ? "Reject account" : "Suspend account"}
            </Button>
          </>
        }
      >
        <FormField
          label="Reason"
          required
          description="Shown to the owner after they sign in."
        >
          <Textarea
            rows={4}
            autoFocus
            placeholder="e.g. Business details could not be verified."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
      </Dialog>

      {/* Permanent delete: the second confirmation is typing the business name. */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteText("");
        }}
        dismissOnOverlayClick={false}
        title={`Permanently delete ${business.name}?`}
        description="This erases the business and ALL of its data — every customer, credit, payment and file. It cannot be undone."
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteText.trim() !== business.name}
              isLoading={del.isPending}
              onClick={onDelete}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <FormField
          label={`Type “${business.name}” to confirm`}
          required
        >
          <Input
            autoFocus
            value={deleteText}
            onChange={(event) => setDeleteText(event.target.value)}
            placeholder={business.name}
          />
        </FormField>
      </Dialog>
    </>
  );

  // ---- menu variant (table rows) -----------------------------------------
  if (variant === "menu") {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${business.name}`}
            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              icon={<Eye />}
              onSelect={() => router.push(`/admin/users/${business.id}`)}
            >
              View details
            </DropdownMenuItem>

            {canApprove ? (
              <DropdownMenuItem
                icon={<CheckCircle2 />}
                onSelect={() => openConfirm(reApproveIsActivate ? "activate" : "approve")}
              >
                Approve
              </DropdownMenuItem>
            ) : null}
            {canActivate ? (
              <DropdownMenuItem icon={<Play />} onSelect={() => openConfirm("activate")}>
                Activate
              </DropdownMenuItem>
            ) : null}
            {canReject ? (
              <DropdownMenuItem icon={<ShieldX />} onSelect={() => openReason("reject")}>
                Reject
              </DropdownMenuItem>
            ) : null}
            {canSuspend ? (
              <DropdownMenuItem icon={<ShieldBan />} onSelect={() => openReason("suspend")}>
                Suspend
              </DropdownMenuItem>
            ) : null}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<Trash2 />}
              destructive
              onSelect={() => setDeleteOpen(true)}
            >
              Delete permanently
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {dialogs}
      </>
    );
  }

  // ---- buttons variant (detail page) -------------------------------------
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canApprove ? (
          <Button
            leftIcon={<CheckCircle2 />}
            onClick={() => openConfirm(reApproveIsActivate ? "activate" : "approve")}
          >
            Approve
          </Button>
        ) : null}
        {canActivate ? (
          <Button leftIcon={<Play />} onClick={() => openConfirm("activate")}>
            Activate
          </Button>
        ) : null}
        {canReject ? (
          <Button variant="outline" leftIcon={<ShieldX />} onClick={() => openReason("reject")}>
            Reject
          </Button>
        ) : null}
        {canSuspend ? (
          <Button variant="outline" leftIcon={<ShieldBan />} onClick={() => openReason("suspend")}>
            Suspend
          </Button>
        ) : null}
        <Button variant="destructive" leftIcon={<Trash2 />} onClick={() => setDeleteOpen(true)}>
          Delete
        </Button>
      </div>
      {dialogs}
    </>
  );
}
