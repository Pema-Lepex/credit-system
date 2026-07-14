import type { ReactNode } from "react";

import { Alert } from "@/components/ui/alert";

export interface AuthCardProps {
  title: string;
  description?: ReactNode;
  /** Server-side failure (bad credentials, API down). Field errors live inline. */
  error?: string | null;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Shared frame for every auth screen. No <Card> border here — on the auth page the
 * form is the hero, and a box around it just adds a line for no reason.
 */
export function AuthCard({ title, description, error, children, footer }: AuthCardProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
        ) : null}
      </div>

      {error ? (
        // role="alert" (from Alert's destructive variant) means a screen reader
        // announces the failure the moment it appears, without moving focus.
        <Alert variant="destructive">{error}</Alert>
      ) : null}

      {children}

      {footer ? <div className="text-muted-foreground text-sm">{footer}</div> : null}
    </div>
  );
}
