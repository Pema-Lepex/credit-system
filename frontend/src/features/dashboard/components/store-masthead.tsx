"use client";

import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";

import { Skeleton } from "@/components/ui";
import { useBusiness, useMoneyFormat } from "@/features/settings/api/business";
import { useAuth } from "@/lib/auth/AuthProvider";
import { assetUrl } from "@/lib/media";
import { avatarTint, cn, initials } from "@/lib/utils";

/**
 * The dashboard's masthead: the shop's own logo and name, above everything else.
 *
 * WHY THIS IS NOT `PageHeader`
 * ----------------------------
 * Every other page uses PageHeader, and should. This one earns an exception: the
 * dashboard is the screen an owner lands on every morning, and putting THEIR shop
 * at the top of it — not the word "Dashboard" — is the difference between using a
 * tool and using your own books. It still owns exactly one `h1`, which is the
 * contract PageHeader exists to keep.
 *
 * WHY THE LOGO IS `object-contain`, UNLIKE THE SETTINGS PREVIEW
 * -------------------------------------------------------------
 * `ImageUpload` crops its thumbnail with object-cover, which is right for a
 * preview — it shows you the crop you are getting. Here it would be wrong: a wide
 * wordmark would lose both ends, and a shop owner seeing their own logo chopped in
 * half is the exact opposite of the feeling this component is for. Contained, on a
 * neutral tile, with the same border/surface tokens as the settings preview.
 */
export interface StoreMastheadProps {
  /** Primary CTA, right-aligned on desktop. */
  actions?: ReactNode;
}

export function StoreMasthead({ actions }: StoreMastheadProps) {
  const { user } = useAuth();
  const business = useBusiness();
  const money = useMoneyFormat();

  // Greeting and date depend on the CLOCK, so they cannot be server-rendered: the
  // server may say "Good morning" and the client "Good afternoon", which is a
  // hydration mismatch. Computed after mount; the line is height-reserved so
  // nothing jumps when it arrives.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const shop = business.data;
  const firstName = user?.fullName?.split(" ")[0];

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <StoreLogo name={shop?.name} logoUrl={shop?.logoUrl} isLoading={business.isPending} />

        <div className="min-w-0">
          {/* The eyebrow: personal, quiet, above the name. */}
          <p className="text-muted-foreground h-4 text-xs font-medium">
            {now ? `${greeting(now)}${firstName ? `, ${firstName}` : ""}` : ""}
          </p>

          {business.isPending ? (
            <Skeleton className="mt-1 h-7 w-48" />
          ) : (
            <h1 className="text-foreground truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {shop?.name ?? "Dashboard"}
            </h1>
          )}

          <p className="text-muted-foreground mt-0.5 h-4 text-xs">
            {now ? longDate(now, money.locale) : ""}
          </p>
        </div>
      </div>

      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

function StoreLogo({
  name,
  logoUrl,
  isLoading,
}: {
  name?: string | null;
  logoUrl?: string | null;
  isLoading: boolean;
}) {
  // A 404 logo must not leave an empty box — same discipline as Avatar.
  const [failed, setFailed] = useState(false);
  const resolved = assetUrl(logoUrl);
  const showImage = Boolean(resolved) && !failed;

  // Re-arm when the logo changes: a shop that uploads a new one after a broken
  // one would otherwise stay on the monogram until a reload.
  useEffect(() => setFailed(false), [logoUrl]);

  if (isLoading) {
    return <Skeleton className="size-14 shrink-0 rounded-xl sm:size-16" />;
  }

  return (
    <div
      className={cn(
        "border-border flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border sm:size-16",
        // The monogram is tinted only when there is no logo; a real logo sits on a
        // neutral tile so it is never fighting a colour it did not choose.
        showImage ? "bg-muted" : avatarTint(name ?? "?"),
      )}
    >
      {showImage ? (
        <Image
          src={resolved as string}
          alt={name ? `${name} logo` : "Shop logo"}
          width={64}
          height={64}
          // Contained with a little breathing room — see the component docstring.
          className="size-full object-contain p-1.5"
          onError={() => setFailed(true)}
          unoptimized
        />
      ) : (
        <span aria-hidden="true" className="text-lg font-semibold sm:text-xl">
          {initials(name) || "?"}
        </span>
      )}
    </div>
  );
}

/** Local clock, deliberately: "good morning" is about where the READER is. */
function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function longDate(now: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(now);
  } catch {
    // A malformed locale from settings must not blank the header.
    return now.toDateString();
  }
}
