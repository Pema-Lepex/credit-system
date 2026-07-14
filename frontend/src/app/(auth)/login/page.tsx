import type { Metadata } from "next";

import { LoginForm } from "@/app/(auth)/login/login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Credit Manager workspace.",
};

/**
 * Statically prerendered — the form markup is in the HTML, not behind a Suspense
 * fallback. LoginForm reads `?next=` from window.location at submit time rather
 * than with useSearchParams, precisely so this page can stay static. See the
 * comment on `safeNext`.
 */
export default function LoginPage() {
  return <LoginForm />;
}
