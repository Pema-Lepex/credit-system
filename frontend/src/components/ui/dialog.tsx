"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useMounted } from "@/hooks/use-mounted";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { dialogVariants, overlayVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons. Primary action LAST (right) — western reading order ends on the CTA. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Destructive confirmations should not be dismissable by a stray backdrop click. */
  dismissOnOverlayClick?: boolean;
  /** Focus this on open instead of the first focusable — e.g. a "Cancel" in a delete dialog. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
} as const;

/**
 * Modal dialog.
 *
 * The four things a modal MUST do, all of which are done here:
 *  1. Trap focus (useFocusTrap) and restore it to the trigger on close.
 *  2. Close on Escape.
 *  3. Lock background scroll (and compensate for the scrollbar so nothing jumps).
 *  4. aria-modal + role="dialog" + aria-labelledby/-describedby, so AT announces
 *     it as a dialog with a name and hides the page behind it.
 *
 * Portalled to <body> so no ancestor's `overflow: hidden` or stacking context can
 * clip it — the single most common cause of "my modal is behind the header".
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissOnOverlayClick = true,
  initialFocusRef,
  className,
}: DialogProps) {
  const mounted = useMounted();
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-description`;

  useScrollLock(open);
  useFocusTrap(panelRef, open, { initialFocusRef });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <motion.div
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={dismissOnOverlayClick ? () => onOpenChange(false) : undefined}
            className="bg-foreground/25 absolute inset-0 backdrop-blur-[2px]"
            // The scrim is a decoration; the dialog's own close button is the
            // accessible way out. Hiding it prevents a stray AT "button" node.
            aria-hidden="true"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            variants={dialogVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              // min-w-0 + overflow-hidden are load-bearing: as a flex child the panel
              // would otherwise stretch to its widest content (a table, the template
              // editor) and blow PAST the viewport, spilling horizontal scroll onto
              // <body> and breaking the whole page's responsiveness on a phone.
              "relative z-10 flex w-full min-w-0 flex-col overflow-hidden",
              // Mobile: a bottom sheet with a rounded top. Desktop: a centred card.
              "max-h-[92dvh] rounded-t-2xl sm:max-h-[85dvh] sm:rounded-xl",
              "border-border bg-card text-card-foreground border shadow-xl",
              "pb-safe sm:pb-0",
              SIZES[size],
              className,
            )}
          >
            <header className="flex items-start gap-4 p-5 sm:p-6">
              <div className="min-w-0 flex-1 space-y-1.5">
                <h2 id={titleId} className="text-base font-semibold tracking-tight">
                  {title}
                </h2>
                {description ? (
                  <p id={descId} className="text-muted-foreground text-sm leading-relaxed">
                    {description}
                  </p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close dialog"
                onClick={() => onOpenChange(false)}
                className="-mt-1 -mr-1 shrink-0"
              >
                <X />
              </Button>
            </header>

            {children ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">
                {children}
              </div>
            ) : null}

            {footer ? (
              <footer className="border-border flex flex-col-reverse gap-2 border-t p-5 sm:flex-row sm:justify-end sm:px-6 sm:py-4">
                {footer}
              </footer>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export interface ConfirmDialogProps extends Omit<
  DialogProps,
  "footer" | "children" | "initialFocusRef"
> {
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
  destructive?: boolean;
}

/**
 * Confirmation dialog. Focus starts on CANCEL for destructive actions — a
 * reflexive Enter should never delete anything.
 */
export function ConfirmDialog({
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  isLoading,
  destructive,
  onOpenChange,
  ...props
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      {...props}
      onOpenChange={onOpenChange}
      size="sm"
      dismissOnOverlayClick={!destructive}
      initialFocusRef={destructive ? cancelRef : undefined}
      footer={
        <>
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            onClick={() => void onConfirm()}
            isLoading={isLoading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
