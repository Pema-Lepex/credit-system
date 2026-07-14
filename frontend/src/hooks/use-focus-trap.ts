"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.getAttribute("aria-hidden") !== "true" &&
      // offsetParent is null for display:none; also covers a collapsed parent.
      (el.offsetParent !== null || el === document.activeElement),
  );
}

/**
 * WCAG 2.1.2 (No Keyboard Trap) inverted: a *modal* must trap focus, and must
 * hand it back where it came from on close. Both halves matter — restoring focus
 * to the trigger is what lets a keyboard user carry on from where they were
 * instead of being dumped at the top of the document.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  options: { initialFocusRef?: RefObject<HTMLElement | null> } = {},
): void {
  const { initialFocusRef } = options;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the requested element, else the first focusable, else the container
    // itself (which carries tabIndex={-1} so it can receive focus).
    const focusFirst = () => {
      const target = initialFocusRef?.current ?? getFocusable(container)[0] ?? container;
      target.focus({ preventScroll: true });
    };
    // rAF: the element may not be laid out yet on the first paint of an entrance
    // animation, and .focus() on a zero-size element is a no-op.
    const raf = requestAnimationFrame(focusFirst);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = getFocusable(container);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active_ = document.activeElement;

      if (event.shiftKey && (active_ === first || active_ === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active_ === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Guards against focus escaping via a programmatic focus() elsewhere on the
    // page, or the browser's own focus restoration after an iframe/devtools blur.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (target && !container.contains(target)) {
        event.stopPropagation();
        focusFirst();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      // Only restore if focus is still (or back) inside the trap or on <body>;
      // if the user has since clicked elsewhere, stealing focus back is rude.
      const current = document.activeElement;
      const shouldRestore =
        current === document.body || (current instanceof Node && container.contains(current));
      if (shouldRestore && previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [active, containerRef, initialFocusRef]);
}
