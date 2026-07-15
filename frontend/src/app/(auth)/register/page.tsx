"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { AuthCard } from "@/components/auth/auth-card";
import { PasswordInput } from "@/components/auth/password-input";
import { PasswordStrength } from "@/components/auth/password-strength";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth/AuthProvider";
import { notifySuperAdminOfSignup } from "@/lib/auth/registration-notice";
import { GraphQLRequestError } from "@/lib/graphql/client";
import { registerSchema, type RegisterValues } from "@/lib/validation/auth";

export default function RegisterPage() {
  const router = useRouter();
  const { register: signUp } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    // onBlur, not onChange: validating every keystroke turns a half-typed email
    // into a red error before the user has finished the word.
    mode: "onBlur",
    defaultValues: {
      fullName: "",
      businessName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const password = watch("password") ?? "";

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signUp({
        email: values.email,
        password: values.password,
        fullName: values.fullName,
        businessName: values.businessName,
      });
      // Tell the super-admin, from the browser (W3Forms' free tier only accepts
      // client-side sends). Fire-and-forget: it must never delay or fail the signup.
      void notifySuperAdminOfSignup({
        businessName: values.businessName,
        ownerName: values.fullName,
        email: values.email,
      });
      toast.success("Workspace created", { description: "Welcome to Credit Manager." });
      router.replace("/dashboard");
    } catch (error) {
      setFormError(
        error instanceof GraphQLRequestError && !error.isNetworkError
          ? error.message
          : "We couldn't reach the server. Check your connection and try again.",
      );
    }
  });

  return (
    <AuthCard
      title="Create your workspace"
      description="Start tracking credit in under a minute. No card required."
      error={formError}
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField label="Your name" required error={errors.fullName?.message}>
          <Input
            autoComplete="name"
            placeholder="Sonam Dorji"
            autoFocus
            {...register("fullName")}
          />
        </FormField>

        <FormField
          label="Business name"
          required
          error={errors.businessName?.message}
          description="Shown on invoices, receipts and reminder emails."
        >
          <Input
            autoComplete="organization"
            placeholder="Dorji General Store"
            {...register("businessName")}
          />
        </FormField>

        <FormField label="Email" required error={errors.email?.message}>
          <Input
            type="email"
            autoComplete="email"
            placeholder="you@business.com"
            {...register("email")}
          />
        </FormField>

        <div className="space-y-2">
          <FormField label="Password" required error={errors.password?.message}>
            <PasswordInput autoComplete="new-password" {...register("password")} />
          </FormField>
          <PasswordStrength value={password} />
        </div>

        <FormField label="Confirm password" required error={errors.confirmPassword?.message}>
          <PasswordInput autoComplete="new-password" {...register("confirmPassword")} />
        </FormField>

        <div className="space-y-1.5">
          <div className="flex items-start gap-2.5">
            <Checkbox id="acceptTerms" className="mt-0.5" {...register("acceptTerms")} />
            <label
              htmlFor="acceptTerms"
              className="text-muted-foreground text-sm leading-relaxed"
            >
              I agree to the{" "}
              <Link
                href="/terms"
                className="text-foreground font-medium underline-offset-4 hover:underline"
              >
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link
                href="/privacy"
                className="text-foreground font-medium underline-offset-4 hover:underline"
              >
                Privacy Policy
              </Link>
              .
            </label>
          </div>
          {errors.acceptTerms ? (
            <p role="alert" className="text-destructive-soft-foreground text-xs font-medium">
              {errors.acceptTerms.message}
            </p>
          ) : null}
        </div>

        <Button
          type="submit"
          size="lg"
          fullWidth
          isLoading={isSubmitting}
          loadingText="Creating workspace…"
        >
          Create workspace
        </Button>
      </form>
    </AuthCard>
  );
}
