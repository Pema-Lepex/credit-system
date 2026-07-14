import type { Metadata } from "next";

import { ResetPasswordForm } from "@/app/(auth)/reset-password/reset-password-form";

export const metadata: Metadata = {
  title: "Set a new password",
};

/**
 * The token is needed during the FIRST render (to decide between the form and the
 * "invalid link" state), so it is read server-side from `searchParams` and passed
 * down as a prop. That makes this route dynamic — correct, and cheap: it is a
 * once-per-reset page, not a hot path.
 *
 * In Next 15 `searchParams` is a Promise (it is request data, and awaiting it is
 * what marks the render dynamic).
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const value = Array.isArray(token) ? token[0] : token;
  return <ResetPasswordForm token={value ?? null} />;
}
