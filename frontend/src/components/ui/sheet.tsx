"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useMounted } from "@/hooks/use-mounted";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { overlayVariants, sheetVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type SheetSide = "left" | "right" | "bottom";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: SheetSide;
  title: string;
  /** Hide the title visually but keep it for AT — a nav drawer rarely wants a heading. */
  hideTitle?: boolean;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const SIDE_CLASSES: Record<SheetSide, string> = {
  left: "inset-y-0 left-0 h-full w-[85vw] max-w-xs border-r",
  right: "inset-y-0 right-0 h-full w-[85vw] max-w-sm border-l",
  bottom: "inset-x-0 bottom-0 max-h-[85dvh] w-full rounded-t-2xl border-t",
};

/**
 * Edge-anchored drawer. Same modal contract as Dialog (focus trap, Esc, scroll
 * lock, aria-modal) — a drawer that skips them is just a div that slides.
 *
 * This is what the sidebar collapses into below `lg`. `pb-safe` keeps the last
 * nav item above the iOS home indicator.
 */
export function Sheet({
  open,
  onOpenChange,
  side = "left",
  title,
  hideTitle = false,
  description,
  children,
  footer,
  className,
}: SheetProps) {
  const mounted = useMounted();
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;

  useScrollLock(open);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50">
          <motion.div
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={() => onOpenChange(false)}
            aria-hidden="true"
            className="bg-foreground/25 absolute inset-0 backdrop-blur-[2px]"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            variants={sheetVariants[side]}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              "border-border bg-card text-card-foreground absolute z-10 flex flex-col shadow-xl",
              "pb-safe",
              SIDE_CLASSES[side],
              className,
            )}
          >
            {/* The close button always renders, even when the title is visually
                hidden: Escape is not discoverable on a touch device. */}
            <header
              className={cn(
                "flex items-start gap-4 px-5 py-4",
                hideTitle && !description ? "" : "border-border border-b",
              )}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <h2
                  id={titleId}
                  className={cn(
                    "text-base font-semibold tracking-tight",
                    hideTitle && "sr-only",
                  )}
                >
                  {title}
                </h2>
                {description ? (
                  <p id={descId} className="text-muted-foreground text-sm">
                    {description}
                  </p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close"
                onClick={() => onOpenChange(false)}
                className="-mr-1 shrink-0"
              >
                <X />
              </Button>
            </header>

            <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
              {children}
            </div>

            {footer ? <footer className="border-border border-t p-4">{footer}</footer> : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
