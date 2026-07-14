"use client";

import { useEffect, useRef } from "react";

/**
 * Structural ref type rather than `RefObject<T>`: RefObject has a *mutable*
 * `current`, which makes it invariant, so `RefObject<HTMLButtonElement>` is not
 * assignable to `RefObject<HTMLElement>` and an array of mixed element refs
 * (a trigger button + a content div) won't type-check. A readonly `current` is
 * covariant and accepts them all.
 */
export type RefLike = { readonly current: HTMLElement | null };

/**
 * Fires when a pointer goes down outside every referenced element.
 *
 * `pointerdown` rather than `click`: a click fires on mouse-*up*, so dragging a
 * text selection from inside a popover out onto the page would close it mid-drag.
 * Touch is covered too, without a second listener.
 */
export function useClickOutside(
  refs: RefLike | ReadonlyArray<RefLike>,
  handler: (event: PointerEvent) => void,
  enabled = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    if (!enabled) return;

    const onPointerDown = (event: PointerEvent) => {
      const value = refsRef.current;
      const list: ReadonlyArray<RefLike> = Array.isArray(value)
        ? (value as ReadonlyArray<RefLike>)
        : [value as RefLike];

      const target = event.target as Node | null;
      if (!target) return;
      // An element already detached from the DOM (e.g. a menu item that unmounted
      // on click) is not "outside" — ignoring it prevents a spurious close.
      if (!document.contains(target)) return;

      const inside = list.some((ref) => ref.current?.contains(target));
      if (!inside) handlerRef.current(event);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [enabled]);
}
