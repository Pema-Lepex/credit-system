"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "next-themes";
import { useState, type ReactNode } from "react";

import { Toaster } from "@/components/ui/toast";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { GraphQLRequestError } from "@/lib/graphql/client";

/**
 * The one client boundary at the top of the tree.
 *
 * Everything below can still be a Server Component — a "use client" parent does
 * not force its `children` to be client, because `children` is passed as an
 * already-rendered prop. This is how the dashboard pages stay server-rendered.
 */
export function Providers({ children }: { children: ReactNode }) {
  // useState, not a module-level QueryClient: on the server a module singleton is
  // shared across ALL requests, which leaks one user's cached data into another's
  // response. One client per component instance is the documented fix.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Never retry an auth failure — the client already tried a token
              // refresh and gave up. Retrying just spams the login redirect.
              if (error instanceof GraphQLRequestError && error.isUnauthenticated) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        // Disabling transitions during the swap kills the ugly 200ms cross-fade of
        // every colour on the page when the theme flips.
        disableTransitionOnChange
      >
        {/* reducedMotion="user" makes Framer honour prefers-reduced-motion for every
            animation in the app — one line instead of a check in each component. */}
        <MotionConfig reducedMotion="user">
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
