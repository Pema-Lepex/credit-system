"use client";

/**
 * The screen a store owner (or their staff) sees while their business is not yet
 * APPROVED. It is the WHOLE page — no sidebar, no business nav — because the spec is
 * explicit: a pending/rejected/suspended account can see its status and nothing
 * else. The backend enforces that regardless (every protected call 403s); this is
 * the humane front of the same wall.
 *
 * Three variants off one `status`:
 *   PENDING   — "awaiting approval", hopeful, no reason.
 *   REJECTED  — the rejection reason, "contact the administrator".
 *   SUSPENDED — the suspension reason, "contact the administrator".
 */

import { Clock, ShieldAlert, ShieldX } from "lucide-react";
import type { ReactNode } from "react";

import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";
import type { ApprovalStatus } from "@/types";

interface Variant {
  icon: ReactNode;
  iconClass: string;
  title: string;
  lead: string;
  showReason: boolean;
}

const VARIANTS: Record<Exclude<ApprovalStatus, "APPROVED">, Variant> = {
  PENDING: {
    icon: <Clock aria-hidden="true" />,
    iconClass: "bg-warning-soft text-warning-soft-foreground",
    title: "Your account is awaiting approval",
    lead: "The administrator needs to verify your account before you can use the system. You will be able to sign in and start working the moment it is approved.",
    showReason: false,
  },
  REJECTED: {
    icon: <ShieldX aria-hidden="true" />,
    iconClass: "bg-destructive-soft text-destructive-soft-foreground",
    title: "Your account was not approved",
    lead: "Your registration has been reviewed and rejected. Please contact the administrator if you believe this is a mistake.",
    showReason: true,
  },
  SUSPENDED: {
    icon: <ShieldAlert aria-hidden="true" />,
    iconClass: "bg-neutral-soft text-neutral-soft-foreground",
    title: "Your account has been suspended",
    lead: "Access to your account has been paused. Please contact the administrator to resolve this.",
    showReason: true,
  },
};

export function AccountStatusScreen({
  status,
  reason,
}: {
  status: Exclude<ApprovalStatus, "APPROVED">;
  reason?: string | null;
}) {
  const { user, logout } = useAuth();
  const variant = VARIANTS[status];

  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="mesh-gradient absolute inset-0" aria-hidden="true" />
      <div className="grid-pattern absolute inset-0 opacity-50" aria-hidden="true" />

      <header className="relative flex items-center justify-between px-6 py-5">
        <Logo />
        <ThemeToggle />
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 pb-16">
        <div className="border-border bg-card w-full max-w-lg rounded-2xl border p-8 shadow-lg sm:p-10">
          <div
            className={cn(
              "mb-6 flex size-12 items-center justify-center rounded-xl [&_svg]:size-6",
              variant.iconClass,
            )}
          >
            {variant.icon}
          </div>

          <h1 className="text-foreground text-2xl font-semibold tracking-tight text-balance">
            {variant.title}
          </h1>
          <p className="text-muted-foreground mt-3 leading-relaxed text-pretty">{variant.lead}</p>

          {variant.showReason && reason ? (
            <div className="border-border bg-muted/40 mt-6 rounded-lg border p-4">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Reason
              </p>
              <p className="text-foreground mt-1 text-sm leading-relaxed whitespace-pre-wrap">
                {reason}
              </p>
            </div>
          ) : null}

          <dl className="border-border mt-6 space-y-2 border-t pt-6 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Signed in as</dt>
              <dd className="text-foreground truncate font-medium">{user?.email}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Current status</dt>
              <dd className="text-foreground font-medium">
                {status.charAt(0) + status.slice(1).toLowerCase()}
              </dd>
            </div>
          </dl>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row-reverse">
            <Button variant="outline" fullWidth onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
