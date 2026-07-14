"use client";

import { useEffect, useRef } from "react";

export interface HotkeyOptions {
  /** ⌘ on macOS, Ctrl elsewhere. The only sane cross-platform default. */
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  enabled?: boolean;
  /** Fire even while the user is typing in an input. Default: false. */
  allowInInput?: boolean;
  preventDefault?: boolean;
}

const EDITABLE = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return EDITABLE.has(target.tagName) || target.isContentEditable;
}

/**
 * Global keyboard shortcut.
 *
 * The handler is held in a ref so a caller passing an inline arrow function
 * doesn't re-bind the listener on every render.
 */
export function useHotkey(
  key: string,
  handler: (event: KeyboardEvent) => void,
  options: HotkeyOptions = {},
): void {
  const {
    meta = false,
    shift = false,
    alt = false,
    enabled = true,
    allowInInput = false,
    preventDefault = true,
  } = options;

  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== key.toLowerCase()) return;
      // metaKey || ctrlKey: one binding, both platforms.
      if (meta && !(event.metaKey || event.ctrlKey)) return;
      if (!meta && (event.metaKey || event.ctrlKey)) return;
      if (shift !== event.shiftKey) return;
      if (alt !== event.altKey) return;
      if (!allowInInput && isTypingTarget(event.target)) return;

      if (preventDefault) event.preventDefault();
      handlerRef.current(event);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, meta, shift, alt, enabled, allowInInput, preventDefault]);
}
