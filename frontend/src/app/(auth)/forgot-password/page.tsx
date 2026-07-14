"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { gqlPublicRequest } from "@/lib/graphql/client";
import { FORGOT_PASSWORD_MUTATION } from "@/lib/auth/queries";
import { forgotPasswordSchema, type ForgotPasswordValues } from "@/lib/validation/auth";

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await gqlPublicRequest<{ requestPasswordReset: { success: boolean; message: string } }>(
        FORGOT_PASSWORD_MUTATION,
        { email: values.email },
      );
    } catch {
      // Swallowed on purpose. Reporting "no account with that email" would be an
      // account-enumeration oracle; the backend returns success either way, and a
      // transport failure must not leak the difference. The user still sees the
      // confirmation screen — and gets nothing in their inbox if there's no account.
    } finally {
      setSentTo(values.email);
    }
  });

  if (sentTo) {
    return (
      <AuthCard
        title="Check your inbox"
        description={
          <>
            If an account exists for{" "}
            <span className="text-foreground font-medium">{sentTo}</span>, we&apos;ve sent a
            link to reset your password. It expires in 30 minutes.
          </>
        }
      >
        <div className="space-y-4">
          <div className="border-border bg-muted/50 flex items-center gap-3 rounded-lg border p-4">
            <MailCheck
              className="text-success-soft-foreground size-5 shrink-0"
              aria-hidden="true"
            />
            <p className="text-muted-foreground text-sm">
              Nothing after a few minutes? Check your spam folder.
            </p>
          </div>

          <Button variant="outline" fullWidth onClick={() => setSentTo(null)}>
            Use a different email
          </Button>

          <Link
            href="/login"
            className="text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 rounded-sm text-sm font-medium transition-colors"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to sign in
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email on your account and we'll send you a reset link."
      footer={
        <Link
          href="/login"
          className="text-primary inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField label="Email" required error={errors.email?.message}>
          <Input
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@business.com"
            {...register("email")}
          />
        </FormField>

        <Button
          type="submit"
          size="lg"
          fullWidth
          isLoading={isSubmitting}
          loadingText="Sending link…"
        >
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}
