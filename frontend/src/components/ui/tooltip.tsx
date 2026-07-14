"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { popoverVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Side = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  content: ReactNode;
  /** A single focusable element. Tooltips on non-focusable elements are invisible to keyboards. */
  children: ReactElement<{
    "aria-describedby"?: string;
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
    onFocus?: (e: React.FocusEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
  }>;
  side?: Side;
  delay?: number;
  /** e.g. ["⌘", "K"] — rendered as kbd chips after the label. */
  shortcut?: string[];
  disabled?: boolean;
}

const SIDE_CLASSES: Record<Side, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

/**
 * WCAG 1.4.13 (Content on Hover or Focus) requires a tooltip to be:
 *  - dismissable without moving the pointer  -> Escape closes it
 *  - hoverable                               -> the panel has pointer-events and
 *                                               sits inside the wrapper, so moving
 *                                               onto it does not trigger mouseleave
 *  - persistent                              -> it stays until blur/leave/Escape
 * It also opens on FOCUS, not just hover, or keyboard users never see it.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  delay = 250,
  shortcut,
  disabled,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const show = useCallback(() => {
    if (disabled) return;
    clear();
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [delay, disabled]);

  const hide = useCallback(() => {
    clear();
    setOpen(false);
  }, []);

  useEffect(() => clear, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, hide]);

  if (!isValidElement(children)) return children;

  const trigger = cloneElement(children, {
    "aria-describedby": open ? id : undefined,
    onMouseEnter: (e: React.MouseEvent) => {
      children.props.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      children.props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      children.props.onFocus?.(e);
      // Focus shows immediately — a keyboard user has already "waited".
      clear();
      if (!disabled) setOpen(true);
    },
    onBlur: (e: React.FocusEvent) => {
      children.props.onBlur?.(e);
      hide();
    },
  });

  return (
    <span className="relative inline-flex">
      {trigger}
      <AnimatePresence>
        {open ? (
          <motion.span
            id={id}
            role="tooltip"
            variants={popoverVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              "absolute z-50 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 whitespace-nowrap",
              "bg-popover text-popover-foreground text-xs font-medium",
              "border-border border shadow-lg",
              SIDE_CLASSES[side],
            )}
          >
            {content}
            {shortcut?.length ? (
              <span className="flex gap-0.5">
                {shortcut.map((key) => (
                  <kbd
                    key={key}
                    className="border-border bg-muted text-muted-foreground rounded border px-1 py-0.5 font-sans text-[10px] leading-none"
                  >
                    {key}
                  </kbd>
                ))}
              </span>
            ) : null}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
