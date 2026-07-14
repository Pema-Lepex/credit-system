"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { AuthCard } from "@/components/auth/auth-card";
import { PasswordInput } from "@/components/auth/password-input";
import { PasswordStrength } from "@/components/auth/password-strength";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { toast } from "@/components/ui/toast";
import { RESET_PASSWORD_MUTATION } from "@/lib/auth/queries";
import { GraphQLRequestError, gqlPublicRequest } from "@/lib/graphql/client";
import { resetPasswordSchema, type ResetPasswordValues } from "@/lib/validation/auth";

export interface ResetPasswordFormProps {
  /** Read server-side from `?token=` by the page. `null` = malformed link. */
  token: string | null;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onBlur",
    defaultValues: { password: "", confirmPassword: "" },
  });

  const password = watch("password") ?? "";

  // A missing token means the user typed the URL or the link was mangled. Fail
  // here rather than letting them fill in a form that cannot possibly succeed.
  if (!token) {
    return (
      <AuthCard
        title="Invalid reset link"
        description="This link is missing its token. Request a fresh one and try again."
        error="The password reset link is invalid or has expired."
        footer={
          <Link
            href="/forgot-password"
            className="text-primary inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Request a new link
          </Link>
        }
      >
        <span />
      </AuthCard>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await gqlPublicRequest<{ resetPassword: { success: boolean; message: string } }>(
        RESET_PASSWORD_MUTATION,
        { token, newPassword: values.password },
      );
      toast.success("Password updated", { description: "Sign in with your new password." });
      router.replace("/login");
    } catch (error) {
      setFormError(
        error instanceof GraphQLRequestError && !error.isNetworkError
          ? "This reset link is invalid or has expired. Request a new one."
          : "We couldn't reach the server. Check your connection and try again.",
      );
    }
  });

  return (
    <AuthCard
      title="Set a new password"
      description="Choose a password you haven't used before."
      error={formError}
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
        <div className="space-y-2">
          <FormField label="New password" required error={errors.password?.message}>
            <PasswordInput autoComplete="new-password" autoFocus {...register("password")} />
          </FormField>
          <PasswordStrength value={password} />
        </div>

        <FormField
          label="Confirm new password"
          required
          error={errors.confirmPassword?.message}
        >
          <PasswordInput autoComplete="new-password" {...register("confirmPassword")} />
        </FormField>

        <Button
          type="submit"
          size="lg"
          fullWidth
          isLoading={isSubmitting}
          loadingText="Updating…"
        >
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
