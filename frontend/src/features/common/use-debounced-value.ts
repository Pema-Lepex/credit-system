"use client";

import { useEffect, useState } from "react";

/**
 * Debounce a fast-changing value (a search box) into a slow-changing one (a
 * query key). 250ms is the sweet spot for search-as-you-type: long enough that a
 * touch-typist's burst is one request, short enough that it never feels laggy.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
