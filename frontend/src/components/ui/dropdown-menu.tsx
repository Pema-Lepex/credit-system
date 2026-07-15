"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { useClickOutside } from "@/hooks/use-click-outside";
import { popoverVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * WAI-ARIA menu button.
 *
 * KEYBOARD CONTRACT (this is the whole reason the component exists):
 *   Trigger:  Enter/Space/↓ open + focus first item, ↑ open + focus last
 *   Menu:     ↑ ↓ move, Home/End jump, Esc close + RESTORE focus to trigger,
 *             Tab closes (a menu is not a tab-through container)
 *
 * Focus is moved by querying the live DOM for [role="menuitem"] rather than a
 * registry of refs: items can be conditionally rendered (permissions!), and a
 * stale registry index silently focuses the wrong row. The DOM is the truth.
 *
 * WHY THE PANEL IS PORTALLED INSTEAD OF POSITIONED `absolute`
 * -----------------------------------------------------------
 * It used to be an absolutely-positioned child of the trigger. That works right up
 * until an ancestor establishes a clipping context -- and TableContainer does, twice
 * (`overflow-hidden` on the frame, `overflow-x-auto` on the scroll region, both
 * necessary). A row's "..." menu was then clipped to the table's bounds and appeared
 * to do nothing on desktop, while working on mobile, where the same rows render as
 * cards outside any overflow container. That is not a table bug to be patched per
 * table; it is what `absolute` means.
 *
 * So the panel renders into document.body and positions itself `fixed` from the
 * trigger's viewport rect. No ancestor can clip it -- not overflow, not a transform,
 * not a stacking context. It is re-measured on scroll/resize (capture phase, so
 * scrolling the table itself counts), and flips above the trigger when there is not
 * room below.
 */

interface Position {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/** Gap between trigger and panel, matching the old `mt-2`. */
const GAP = 8;
/** Keep the panel off the very edge of the viewport. */
const EDGE = 8;

/**
 * useLayoutEffect is the right hook (measure before paint, so the panel never shows
 * at the wrong spot) but React logs a warning when it runs during SSR, where there is
 * no layout to read. This component is prerendered on every page that has a table, so
 * fall back to useEffect on the server, where the body no-ops anyway.
 */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface DropdownContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerId: string;
  menuId: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  /** Which item to focus once the menu paints. */
  pendingFocus: React.RefObject<"first" | "last" | null>;
}

const DropdownContext = createContext<DropdownContextValue | null>(null);

function useDropdown(): DropdownContextValue {
  const ctx = useContext(DropdownContext);
  if (!ctx) throw new Error("DropdownMenu components must be used inside <DropdownMenu>");
  return ctx;
}

function items(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'),
  );
}

export function DropdownMenu({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const baseId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pendingFocus = useRef<"first" | "last" | null>(null);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    // Closing must always return focus to the trigger, or the keyboard user is
    // stranded at the top of the document.
    if (!next) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  // Close on outside pointerdown WITHOUT restoring focus to the trigger — the
  // user is already pointing at something else; yanking focus back would be rude.
  useClickOutside([triggerRef, contentRef], () => setOpenState(false), open);

  const ctx = useMemo<DropdownContextValue>(
    () => ({
      open,
      setOpen,
      triggerId: `${baseId}-trigger`,
      menuId: `${baseId}-menu`,
      triggerRef,
      contentRef,
      pendingFocus,
    }),
    [open, setOpen, baseId],
  );

  return (
    <DropdownContext.Provider value={ctx}>
      <div className="relative inline-flex">{children}</div>
    </DropdownContext.Provider>
  );
}

export type DropdownMenuTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function DropdownMenuTrigger({
  children,
  onClick,
  onKeyDown,
  ...props
}: DropdownMenuTriggerProps) {
  const { open, setOpen, triggerId, menuId, triggerRef, pendingFocus } = useDropdown();

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pendingFocus.current = "first";
      setOpen(true);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      pendingFocus.current = "last";
      setOpen(true);
    }
  };

  return (
    <button
      ref={triggerRef}
      type="button"
      id={triggerId}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        pendingFocus.current = null; // mouse users don't want a focused first item
        setOpen(!open);
      }}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {children}
    </button>
  );
}

export interface DropdownMenuContentProps {
  children: ReactNode;
  align?: "start" | "end";
  side?: "top" | "bottom";
  className?: string;
  /** Screen-reader name for the menu. Defaults to the trigger via aria-labelledby. */
  "aria-label"?: string;
}

export function DropdownMenuContent({
  children,
  align = "end",
  side = "bottom",
  className,
  "aria-label": ariaLabel,
}: DropdownMenuContentProps) {
  const { open, setOpen, menuId, triggerId, triggerRef, contentRef, pendingFocus } = useDropdown();
  const [position, setPosition] = useState<Position | null>(null);

  // Focus the requested item once the panel is in the DOM.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      const list = items(contentRef.current);
      if (list.length === 0) {
        contentRef.current?.focus({ preventScroll: true });
        return;
      }
      const target = pendingFocus.current === "last" ? list[list.length - 1] : list[0];
      if (pendingFocus.current !== null) target?.focus({ preventScroll: true });
      pendingFocus.current = null;
    });
    return () => cancelAnimationFrame(raf);
  }, [open, contentRef, pendingFocus]);

  // Anchor the fixed panel to the trigger's viewport rect, and keep it there.
  useIsomorphicLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      // Height is 0 on the very first pass (the panel has not painted yet); we then
      // re-run below once it has, so the flip decision is made on a real height.
      const height = contentRef.current?.offsetHeight ?? 0;

      const spaceBelow = window.innerHeight - rect.bottom;
      const flipUp =
        side === "top" ||
        (height > 0 && spaceBelow < height + GAP && rect.top > spaceBelow);

      const next: Position = flipUp
        ? { bottom: window.innerHeight - rect.top + GAP }
        : { top: rect.bottom + GAP };

      if (align === "end") next.right = Math.max(EDGE, window.innerWidth - rect.right);
      else next.left = Math.max(EDGE, rect.left);

      setPosition(next);
    };

    place();
    // A second pass once the panel has a measurable height, so `flipUp` is decided
    // on the real size rather than 0.
    const raf = requestAnimationFrame(place);

    // Capture phase: a scroll inside the TABLE does not bubble to window, and that is
    // exactly the container this menu now escapes. Without capture, the panel would
    // hang in mid-air when the table scrolls under it.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, align, side, triggerRef, contentRef]);

  // Drop the stale rect when closed, so the next open never paints at the old spot.
  useEffect(() => {
    if (!open) setPosition(null);
  }, [open]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = items(contentRef.current);
    const index = list.indexOf(document.activeElement as HTMLElement);

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        list[(index + 1) % list.length]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        list[(index - 1 + list.length) % list.length]?.focus();
        break;
      case "Home":
        event.preventDefault();
        list[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        list[list.length - 1]?.focus();
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        // Do not trap: let Tab move on, but the menu must not stay open behind it.
        setOpen(false);
        break;
      default:
        break;
    }
  };

  // No document during SSR/prerender; the panel only ever exists after interaction.
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={contentRef}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-labelledby={ariaLabel ? undefined : triggerId}
          aria-label={ariaLabel}
          aria-orientation="vertical"
          variants={popoverVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onKeyDown={onKeyDown}
          style={{
            position: "fixed",
            ...position,
            // Hidden for the single frame before the rect is measured — otherwise the
            // panel flashes at the top-left of the viewport before snapping into place.
            visibility: position ? "visible" : "hidden",
          }}
          className={cn(
            "z-50 min-w-52 overflow-hidden rounded-lg p-1",
            // Cap to the viewport (8px gutter each side, matching EDGE). A menu with a
            // fixed width like `w-80`/`w-96` is otherwise anchored on ONE edge only, so
            // on a narrow phone it runs off the far edge and gets clipped — the panel
            // looks "hidden". max-width wins over the width class whenever it's smaller.
            "max-w-[calc(100vw-1rem)]",
            "border-border bg-popover text-popover-foreground border shadow-lg",
            "focus-visible:outline-none",
            align === "end" ? "origin-top-right" : "origin-top-left",
            className,
          )}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export interface DropdownMenuItemProps {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  icon?: ReactNode;
  shortcut?: string;
  className?: string;
}

export function DropdownMenuItem({
  children,
  onSelect,
  disabled,
  destructive,
  icon,
  shortcut,
  className,
}: DropdownMenuItemProps) {
  const { setOpen } = useDropdown();

  const activate = () => {
    if (disabled) return;
    setOpen(false);
    onSelect?.();
  };

  return (
    <div
      role="menuitem"
      // tabIndex=-1 everywhere: the menu is entered programmatically and driven by
      // arrows, so items must not appear in the document tab order.
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm select-none",
        "transition-colors duration-100",
        "focus-visible:outline-none",
        destructive
          ? "text-destructive-soft-foreground hover:bg-destructive-soft focus:bg-destructive-soft"
          : "text-foreground hover:bg-muted focus:bg-muted",
        disabled && "pointer-events-none opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-current",
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="shrink-0 opacity-80">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? (
        <kbd className="text-muted-foreground ml-auto shrink-0 text-[11px] tracking-wide">
          {shortcut}
        </kbd>
      ) : null}
    </div>
  );
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground px-2.5 py-2 text-xs font-medium">{children}</div>
  );
}

export function DropdownMenuSeparator() {
  return <div role="separator" className="bg-border -mx-1 my-1 h-px" />;
}
