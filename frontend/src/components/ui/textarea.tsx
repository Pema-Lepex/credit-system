import { forwardRef } from "react";

import { fieldBaseVariants } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows = 4, ...props },
  ref,
) {
  const isInvalid = Boolean(invalid) || props["aria-invalid"] === true;

  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={isInvalid || undefined}
      className={cn(
        fieldBaseVariants({ invalid: isInvalid }),
        // Height is driven by `rows`; the field variant's fixed `h-9` must go.
        "h-auto min-h-20 resize-y px-3 py-2 text-sm leading-relaxed",
        className,
      )}
      {...props}
    />
  );
});
