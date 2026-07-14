"use client";

import { cva, type VariantProps } from "class-variance-authority";
import Image from "next/image";
import { forwardRef, useState } from "react";

import { assetUrl } from "@/lib/media";
import { avatarTint, cn, initials } from "@/lib/utils";

const avatarVariants = cva(
  "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-medium",
  {
    variants: {
      size: {
        xs: "size-6 text-[10px]",
        sm: "size-8 text-xs",
        md: "size-9 text-sm",
        lg: "size-11 text-sm",
        xl: "size-16 text-lg",
      },
    },
    defaultVariants: { size: "md" },
  },
);

const PX: Record<NonNullable<AvatarProps["size"]>, number> = {
  xs: 24,
  sm: 32,
  md: 36,
  lg: 44,
  xl: 64,
};

export interface AvatarProps
  extends
    Omit<React.HTMLAttributes<HTMLSpanElement>, "children">,
    VariantProps<typeof avatarVariants> {
  src?: string | null;
  /** The person/thing the avatar represents. Drives initials AND the alt text. */
  name?: string | null;
  /** Stable seed for the fallback tint. Defaults to `name`. */
  seed?: string;
}

/**
 * Falls back to tinted initials on a missing OR broken image — a 404 avatar must
 * not leave a grey box. The tint is hashed from the seed so a given user is
 * always the same colour, which makes an avatar list scannable.
 *
 * The `src` is absolutised HERE rather than at the call sites. The API hands back
 * file paths relative to itself ("/api/files/…"), which resolve against the FRONTEND
 * origin and 404 — and a 404 lands in the fallback above, so a perfectly good
 * uploaded photo just showed up as initials, with no error anywhere. Half the call
 * sites remembered to wrap it and half did not; doing it in the component means none
 * of them have to. assetUrl leaves absolute/blob/data URLs untouched, so passing an
 * already-absolute URL (or an in-flight upload preview) still works.
 */
export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { className, size = "md", src, name, seed, ...props },
  ref,
) {
  const [failed, setFailed] = useState(false);
  const resolved = assetUrl(src);
  const showImage = Boolean(resolved) && !failed;
  const label = name ?? "";
  const px = PX[size ?? "md"];

  return (
    <span
      ref={ref}
      className={cn(
        avatarVariants({ size }),
        !showImage && avatarTint(seed ?? label ?? "?"),
        "ring-border ring-1 ring-inset",
        className,
      )}
      {...props}
    >
      {showImage ? (
        <Image
          src={resolved as string}
          alt={label ? `${label} avatar` : ""}
          width={px}
          height={px}
          className="size-full object-cover"
          onError={() => setFailed(true)}
          unoptimized
        />
      ) : (
        // The initials are decorative once a real name is elsewhere in the row;
        // exposing them would have a screen reader spell "S D".
        <span aria-hidden="true">{initials(label)}</span>
      )}
    </span>
  );
});

export { avatarVariants };
