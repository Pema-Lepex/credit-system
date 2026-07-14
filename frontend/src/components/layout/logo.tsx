import { cn } from "@/lib/utils";

/**
 * Wordmark. The glyph is inline SVG rather than an <img>: it must recolour with
 * the theme (currentColor) and must not cost a network round-trip on first paint.
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
      <span className="bg-primary text-primary-foreground shadow-glow flex size-8 shrink-0 items-center justify-center rounded-lg">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="size-4"
          aria-hidden="true"
          strokeWidth="2.2"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 8.5h18M3 8.5A2.5 2.5 0 0 1 5.5 6h13A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-9Z" />
          <path d="M7 14.5h4" />
        </svg>
      </span>
      {showWordmark ? (
        <span className="text-foreground truncate text-sm font-semibold tracking-tight">
          Credit Manager
        </span>
      ) : null}
    </span>
  );
}
