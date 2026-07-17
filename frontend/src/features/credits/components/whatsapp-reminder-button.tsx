"use client";

/**
 * "Remind on WhatsApp" — composes the message, shows it, opens WhatsApp.
 *
 * WHY A REVIEW DIALOG AND NOT A STRAIGHT window.open()
 * ----------------------------------------------------
 * Two reasons, and the second is the real one.
 *
 * 1. Popup blockers. The link has to be fetched from the server first, and by the
 *    time that promise resolves the browser no longer considers the click a user
 *    gesture — Safari and Chrome both swallow the window. An <a href> that the
 *    owner clicks themselves is always allowed. (Opening a blank tab up-front and
 *    redirecting it later dodges the blocker but strands an empty tab whenever the
 *    compose fails, which is exactly when the customer's number is malformed.)
 *
 * 2. It is a message to a real person, about money, going out under the shop's
 *    name. Showing it first costs one click and means the owner can never be
 *    surprised by what they just sent to a neighbour.
 *
 * WHAT THIS DOES NOT DO: send anything. WhatsApp opens with the text pre-filled and
 * the owner taps Send. The server has no WhatsApp session and never will — see
 * backend/app/services/whatsapp.py for why that is a deliberate trade and not a gap.
 */

import { Check, Copy, ExternalLink, MessageCircle } from "lucide-react";
import { useState } from "react";

import { Alert, Button, Dialog, buttonVariants, toast } from "@/components/ui";
import { useComposeWhatsappReminder } from "@/features/credits/hooks/use-credit-mutations";
import type { WhatsAppLink } from "@/features/credits/queries";
import { cn } from "@/lib/utils";
import type { ID } from "@/types";

interface WhatsAppReminderButtonProps {
  creditId: ID;
  disabled?: boolean;
  variant?: "secondary" | "outline" | "ghost";
  size?: "sm" | "md";
  className?: string;
  /** Render just the icon (for a cramped table row). */
  iconOnly?: boolean;
}

export function WhatsAppReminderButton({
  creditId,
  disabled,
  variant = "outline",
  size = "sm",
  className,
  iconOnly = false,
}: WhatsAppReminderButtonProps) {
  const compose = useComposeWhatsappReminder();
  const [link, setLink] = useState<WhatsAppLink | null>(null);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={disabled || compose.isPending}
        isLoading={compose.isPending}
        leftIcon={iconOnly ? undefined : <MessageCircle />}
        aria-label={iconOnly ? "Remind on WhatsApp" : undefined}
        onClick={() => compose.mutate(creditId, { onSuccess: setLink })}
      >
        {iconOnly ? <MessageCircle className="size-4" /> : "WhatsApp"}
      </Button>

      <WhatsAppReviewDialog link={link} onClose={() => setLink(null)} />
    </>
  );
}

/**
 * The review step, exported so a dropdown menu can host it too.
 *
 * A menu unmounts its items on select, taking any dialog rendered inside one with
 * it — so the caller renders this as a SIBLING of the menu and drives it with the
 * composed link.
 */
export function WhatsAppReviewDialog({
  link,
  onClose,
}: {
  link: WhatsAppLink | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is permission-gated and unavailable over plain http. The message
      // is already on screen and selectable, so this is a convenience, not a path
      // anything depends on.
      toast.error("Could not copy — select the message and copy it manually.");
    }
  };

  return (
    <Dialog
      open={link !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Send this on WhatsApp?"
      description={
        link
          ? `To ${link.customerName} on +${link.toPhone}. Nothing has been sent yet.`
          : undefined
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" leftIcon={copied ? <Check /> : <Copy />} onClick={() => void copy()}>
            {copied ? "Copied" : "Copy message"}
          </Button>
          {/* A real anchor, clicked by the user: never popup-blocked, and it works
              on a phone (opens the app) and on desktop (opens WhatsApp Web). */}
          <a
            href={link?.url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "primary" }))}
            onClick={onClose}
          >
            <ExternalLink aria-hidden="true" className="size-4" />
            Open WhatsApp
          </a>
        </>
      }
    >
      <div className="space-y-3">
        {/* pre-wrap: the message is plain text with real newlines, and it must look
            here exactly as it will look in the chat. */}
        <div className="border-border bg-muted/40 max-h-72 overflow-y-auto rounded-lg border p-3">
          <p className="text-foreground text-sm whitespace-pre-wrap">{link?.text}</p>
        </div>

        <Alert variant="neutral">
          WhatsApp will open with this message ready — <strong>you still tap Send</strong>.
          It goes from whichever WhatsApp account is signed in on this device, not from
          the number saved in Settings.
        </Alert>
      </div>
    </Dialog>
  );
}
