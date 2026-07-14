"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

export interface RovingFocusOptions {
  /** Number of focusable items. */
  count: number;
  /** Wrap from last to first (menus do; toolbars often don't). */
  loop?: boolean;
  orientation?: "vertical" | "horizontal";
  onEscape?: () => void;
  /** Enter/Space on the active item. */
  onSelect?: (index: number) => void;
  /** Index to start on when the collection becomes active. */
  initialIndex?: number;
  active: boolean;
}

/**
 * Roving tabindex — the WAI-ARIA pattern for menus/listboxes.
 *
 * Only ONE item is in the tab sequence at a time; Arrow keys move the active
 * index and focus follows. That is what makes a menu one Tab stop instead of
 * fifteen, and it is the difference between "keyboard accessible" and "keyboard
 * survivable".
 */
export function useRovingFocus({
  count,
  loop = true,
  orientation = "vertical",
  onEscape,
  onSelect,
  initialIndex = -1,
  active,
}: RovingFocusOptions) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    if (!active) setActiveIndex(initialIndex);
  }, [active, initialIndex]);

  // Focus follows the active index. Menus focus the item itself (not aria-
  // activedescendant) because native focus gives us free screen-reader output.
  useEffect(() => {
    if (!active || activeIndex < 0) return;
    itemRefs.current[activeIndex]?.focus({ preventScroll: false });
  }, [active, activeIndex]);

  const registerItem = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      itemRefs.current[index] = el;
    },
    [],
  );

  const move = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        if (count === 0) return -1;
        const next = current + delta;
        if (next < 0) return loop ? count - 1 : 0;
        if (next >= count) return loop ? 0 : count - 1;
        return next;
      });
    },
    [count, loop],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const nextKey = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
      const prevKey = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";

      switch (event.key) {
        case nextKey:
          event.preventDefault();
          move(1);
          break;
        case prevKey:
          event.preventDefault();
          move(-1);
          break;
        case "Home":
          event.preventDefault();
          setActiveIndex(0);
          break;
        case "End":
          event.preventDefault();
          setActiveIndex(count - 1);
          break;
        case "Escape":
          event.preventDefault();
          onEscape?.();
          break;
        case "Enter":
        case " ":
          if (activeIndex >= 0) {
            event.preventDefault();
            onSelect?.(activeIndex);
          }
          break;
        default:
          break;
      }
    },
    [activeIndex, count, move, onEscape, onSelect, orientation],
  );

  return { activeIndex, setActiveIndex, registerItem, onKeyDown };
}
