import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * Wordmark. The glyph is the brand icon (public/brand-icon.png) shown through
 * next/image so it is optimised and cached. It appears everywhere this component is
 * used — the public header, the dashboard sidebar (icon-only when collapsed), the
 * auth screens and the admin panel — so the whole app carries one identity.
 */
export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Image
        src="/brand-icon.png"
        // Decorative when the wordmark names the product; the label when it doesn't
        // (e.g. the collapsed sidebar, where the icon stands alone).
        alt={showWordmark ? "" : "Credit Manager"}
        width={32}
        height={32}
        className="ring-border/70 size-8 shrink-0 rounded-lg object-cover ring-1"
        priority
      />
      {showWordmark ? (
        <span className="text-foreground truncate text-sm font-semibold tracking-tight">
          Credit Manager
        </span>
      ) : null}
    </span>
  );
}
