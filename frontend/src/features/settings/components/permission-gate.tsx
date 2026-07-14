"use client";

import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent, EmptyState, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { Permission } from "@/types";

export interface PermissionGateProps {
  permission: Permission;
  children: ReactNode;
  /** What the user is being denied, for the message: "manage staff accounts". */
  action?: string;
}

/**
 * Renders `children` only if the signed-in user holds `permission`.
 *
 * This is an AFFORDANCE, not a security control — the server re-checks every
 * query and mutation with `require(user, Permission.X)`. Its job is to replace a
 * page full of buttons that would all fail with one sentence that explains why.
 */
export function PermissionGate({ permission, children, action }: PermissionGateProps) {
  const { hasPermission, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Spinner label="Checking your access" />
      </div>
    );
  }

  if (!hasPermission(permission)) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState
            icon={<Lock />}
            title="You don't have access to this"
            description={
              action
                ? `Your role doesn't allow you to ${action}. Ask an administrator if you need it.`
                : "Your role doesn't allow you to view this section. Ask an administrator if you need access."
            }
          />
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}
