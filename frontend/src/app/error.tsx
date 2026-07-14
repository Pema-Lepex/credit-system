"use client";

import { RotateCw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary.
 *
 * The backend is being built in parallel and WILL be down sometimes. A thrown
 * render error must land here — a readable page with a retry — not on a white
 * screen. `reset()` re-renders the segment without a full reload, so an
 * intermittent network failure recovers in place.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Replace with a real reporter (Sentry et al.) when one exists.
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-muted-foreground mx-auto max-w-md text-sm leading-relaxed">
          {error.message || "An unexpected error occurred while loading this page."}
        </p>
        {error.digest ? (
          <p className="text-muted-foreground font-mono text-xs">Reference: {error.digest}</p>
        ) : null}
      </div>
      <Button onClick={reset} leftIcon={<RotateCw />}>
        Try again
      </Button>
    </div>
  );
}
