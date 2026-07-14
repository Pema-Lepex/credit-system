"use client";

import { useSyncExternalStore } from "react";

/**
 * SSR-safe media query.
 *
 * useSyncExternalStore (rather than useState + useEffect) because it gives React
 * an explicit server snapshot — which kills the hydration flash where the mobile
 * layout renders for one frame on desktop.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = (onChange: () => void): (() => void) => {
    if (typeof window === "undefined") return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  };

  const getSnapshot = (): boolean =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches;

  // The server cannot know the viewport. We assume "not matching" and let the
  // client correct it; every consumer must therefore degrade sanely to desktop.
  const getServerSnapshot = (): boolean => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Breakpoints mirror Tailwind's defaults so CSS and JS never disagree.
export const useIsMobile = (): boolean => useMediaQuery("(max-width: 767px)");
export const useIsTablet = (): boolean =>
  useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
export const useIsDesktop = (): boolean => useMediaQuery("(min-width: 1024px)");
