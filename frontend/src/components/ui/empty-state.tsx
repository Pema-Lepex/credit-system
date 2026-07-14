import { forwardRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** Primary + secondary CTA live here. An empty state without a next step is a dead end. */
  action?: ReactNode;
  size?: "sm" | "md";
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { className, icon, title, description, action, size = "md", ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "border-border flex flex-col items-center justify-center rounded-lg border border-dashed text-center",
        size === "sm" ? "gap-3 px-6 py-10" : "gap-4 px-6 py-16",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-xl [&_svg]:size-5"
        >
          {icon}
        </div>
      ) : null}
      <div className="max-w-sm space-y-1.5">
        <p className="text-foreground text-sm font-semibold">{title}</p>
        {description ? (
          <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
        ) : null}
      </div>
      {action ? (
        <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>
      ) : null}
    </div>
  );
});
