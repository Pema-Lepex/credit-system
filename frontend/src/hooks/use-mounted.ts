"use client";

import { useEffect, useState } from "react";

/**
 * True only after hydration. Needed by anything whose correct output depends on
 * browser-only state (the theme toggle reads next-themes' resolved theme, which
 * the server cannot know) — render a neutral placeholder until then or React
 * throws a hydration mismatch.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
