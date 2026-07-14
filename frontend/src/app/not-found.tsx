import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/layout/logo";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="radial-fade relative flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <Logo />
      <div className="space-y-3">
        <p className="text-primary text-sm font-medium">404</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          We couldn&apos;t find that page
        </h1>
        <p className="text-muted-foreground mx-auto max-w-sm text-sm leading-relaxed">
          The link may be broken, or the record may have been archived under your retention
          policy.
        </p>
      </div>
      <Link href="/dashboard" className={buttonVariants({ variant: "primary", size: "lg" })}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to dashboard
      </Link>
    </div>
  );
}
