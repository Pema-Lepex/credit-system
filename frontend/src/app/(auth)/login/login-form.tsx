"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { AuthCard } from "@/components/auth/auth-card";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth/AuthProvider";
import { GraphQLRequestError } from "@/lib/graphql/client";
import { loginSchema, type LoginValues } from "@/lib/validation/auth";

/**
 * Where to land after a successful sign-in.
 *
 * Read from `window.location` at SUBMIT time rather than with useSearchParams:
 * useSearchParams opts the component out of static prerendering, which would ship
 * a skeleton in the HTML and pop the real form in on hydration — a visible flash
 * on the app's most-visited page. The `next` param is only needed once, after a
 * click, by which point `window` certainly exists.
 *
 * Only same-origin paths are honoured. `?next=https://evil.com` (or the
 * protocol-relative `//evil.com`) is an open-redirect, which is a real phishing
 * primitive on a login page.
 */
function safeNext(): string {
  if (typeof window === "undefined") return "/dashboard";
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  return next;
}

export function LoginForm() {
  const router = useRouter();
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await login(values.email, values.password);
      // The one role-based fork: the platform operator lands on the admin panel,
      // everyone else on the app (where the approval gate takes over if they are not
      // yet approved). Credentials are the same JWT flow either way — there is no
      // separate super-admin login path.
      router.replace(user.role === "SUPER_ADMIN" ? "/admin" : safeNext());
    } catch (error) {
      setFormError(
        error instanceof GraphQLRequestError && !error.isNetworkError
          ? // Never distinguish "no such user" from "wrong password" — that is a
            // free account-enumeration oracle.
            "Incorrect email or password."
          : "We couldn't reach the server. Check your connection and try again.",
      );
    }
  });

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to pick up where you left off."
      error={formError}
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </>
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

        <div className="space-y-1.5">
          <FormField label="Password" required error={errors.password?.message}>
            <PasswordInput
              autoComplete="current-password"
              placeholder="••••••••"
              {...register("password")}
            />
          </FormField>
          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-muted-foreground hover:text-foreground rounded-sm text-xs font-medium underline-offset-4 transition-colors hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        <Button
          type="submit"
          size="lg"
          fullWidth
          isLoading={isSubmitting}
          loadingText="Signing in…"
        >
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
