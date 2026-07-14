"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Save } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";

import { PasswordInput } from "@/components/auth/password-input";
import { PasswordStrength } from "@/components/auth/password-strength";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Select,
  toast,
} from "@/components/ui";
import { useChangePassword, useUpdateProfile } from "@/features/settings/api/profile";
import { ImageUpload } from "@/features/settings/components/image-upload";
import { absoluteUrl } from "@/features/settings/lib/http";
import { LOCALES } from "@/features/settings/lib/locale-data";
import {
  changePasswordSchema,
  profileSchema,
  type ChangePasswordValues,
  type ProfileValues,
} from "@/features/settings/lib/schemas";
import { useAuth } from "@/lib/auth/AuthProvider";
import { GraphQLRequestError } from "@/lib/graphql/client";

const THEME_OPTIONS = [
  { value: "system", label: "Match my system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ProfileForm() {
  const { user, refreshUser } = useAuth();
  const { setTheme } = useTheme();
  const updateProfile = useUpdateProfile();

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullName: "",
      phone: "",
      avatarFileId: null,
      theme: "system",
      language: "en-US",
    },
  });

  useEffect(() => {
    if (!user) return;
    reset({
      fullName: user.fullName,
      phone: user.phone ?? "",
      avatarFileId: null,
      theme: user.theme ?? "system",
      language: user.language || "en-US",
    });
  }, [user, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await updateProfile.mutateAsync({
        fullName: values.fullName.trim(),
        phone: values.phone.trim() === "" ? null : values.phone.trim(),
        avatarFileId: values.avatarFileId ?? undefined,
        theme: values.theme,
        language: values.language,
      });
      // The stored preference is the source of truth across devices; apply it here
      // and now so the page does not keep the old theme until the next reload.
      setTheme(values.theme);
      await refreshUser();
      toast.success("Profile updated.");
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError ? error.message : "Could not save your profile.",
      );
    }
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <form onSubmit={onSubmit} noValidate>
        <Card>
          <CardHeader>
            <CardTitle>Your profile</CardTitle>
            <CardDescription>
              How you appear to your team. Your email is fixed — ask an administrator to change
              it.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            <ImageUpload
              label="Avatar"
              description="A square image works best. Up to 5 MB."
              shape="circle"
              kind="USER_AVATAR"
              currentUrl={absoluteUrl(user?.avatarUrl)}
              onUploaded={(fileId) => setValue("avatarFileId", fileId, { shouldDirty: true })}
              onRemoved={() => setValue("avatarFileId", null, { shouldDirty: true })}
            />

            <FormField label="Full name" required error={errors.fullName?.message}>
              <Input {...register("fullName")} autoComplete="name" />
            </FormField>

            <FormField label="Email">
              <Input value={user?.email ?? ""} readOnly disabled />
            </FormField>

            <FormField label="Phone" error={errors.phone?.message}>
              <Input type="tel" {...register("phone")} autoComplete="tel" />
            </FormField>

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField label="Appearance" error={errors.theme?.message}>
                <Controller
                  control={control}
                  name="theme"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onChange={(event) =>
                        field.onChange(event.target.value as ProfileValues["theme"])
                      }
                      options={THEME_OPTIONS}
                    />
                  )}
                />
              </FormField>

              <FormField label="Language" error={errors.language?.message}>
                <Select
                  {...register("language")}
                  options={LOCALES.map((l) => ({ value: l.value, label: l.label }))}
                />
              </FormField>
            </div>
          </CardContent>

          <div className="border-border flex items-center justify-end gap-2 border-t p-5 sm:px-6 sm:py-4">
            <Button
              type="button"
              variant="outline"
              disabled={!isDirty || isSubmitting}
              onClick={() =>
                user &&
                reset({
                  fullName: user.fullName,
                  phone: user.phone ?? "",
                  avatarFileId: null,
                  theme: user.theme ?? "system",
                  language: user.language || "en-US",
                })
              }
            >
              Discard
            </Button>
            <Button
              type="submit"
              leftIcon={<Save />}
              isLoading={isSubmitting}
              loadingText="Saving…"
              disabled={!isDirty}
            >
              Save profile
            </Button>
          </div>
        </Card>
      </form>

      <ChangePasswordForm />
    </div>
  );
}

function ChangePasswordForm() {
  const changePassword = useChangePassword();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const newPassword = watch("newPassword");

  const onSubmit = handleSubmit(async (values) => {
    try {
      await changePassword.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      reset({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast.success("Password changed.", {
        description: "Use your new password the next time you sign in.",
      });
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError
          ? error.message
          : "Could not change your password.",
      );
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" aria-hidden="true" />
            Change password
          </CardTitle>
          <CardDescription>
            You will stay signed in on this device. Other sessions are unaffected.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <FormField label="Current password" required error={errors.currentPassword?.message}>
            <PasswordInput {...register("currentPassword")} autoComplete="current-password" />
          </FormField>

          <div className="space-y-2">
            <FormField
              label="New password"
              required
              description="At least 8 characters, with an uppercase letter, a lowercase letter and a number."
              error={errors.newPassword?.message}
            >
              <PasswordInput {...register("newPassword")} autoComplete="new-password" />
            </FormField>
            <PasswordStrength value={newPassword} />
          </div>

          <FormField
            label="Confirm new password"
            required
            error={errors.confirmPassword?.message}
          >
            <PasswordInput {...register("confirmPassword")} autoComplete="new-password" />
          </FormField>

          <Alert variant="neutral">
            Choose something you do not use anywhere else. A password manager is the easiest way
            to keep this safe.
          </Alert>
        </CardContent>

        <div className="border-border flex items-center justify-end border-t p-5 sm:px-6 sm:py-4">
          <Button type="submit" isLoading={isSubmitting} loadingText="Changing…">
            Change password
          </Button>
        </div>
      </Card>
    </form>
  );
}
