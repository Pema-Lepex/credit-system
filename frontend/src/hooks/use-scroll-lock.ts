"use client";

import { useEffect } from "react";

/**
 * Freeze background scrolling while an overlay is open.
 *
 * Two details that most implementations get wrong:
 *  - Removing the scrollbar shifts the whole page left by ~15px. We pad the body
 *    by the exact scrollbar width to compensate, so nothing jumps.
 *  - Nested overlays (dialog opens a dropdown) must not each restore on close, so
 *    we refcount and only restore when the last consumer unlocks.
 */
let lockCount = 0;
let previousOverflow = "";
let previousPaddingRight = "";

export function useScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked || typeof document === "undefined") return;

    if (lockCount === 0) {
      const { body } = document;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      previousOverflow = body.style.overflow;
      previousPaddingRight = body.style.paddingRight;
      body.style.overflow = "hidden";
      if (scrollbarWidth > 0) {
        const current = parseFloat(window.getComputedStyle(body).paddingRight) || 0;
        body.style.paddingRight = `${current + scrollbarWidth}px`;
      }
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        document.body.style.overflow = previousOverflow;
        document.body.style.paddingRight = previousPaddingRight;
      }
    };
  }, [locked]);
}
