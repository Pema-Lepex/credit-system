"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { PasswordStrength } from "@/components/auth/password-strength";
import {
  Button,
  Dialog,
  FormField,
  Input,
  Select,
  Switch,
  toast,
} from "@/components/ui";
import {
  assignableRoles,
  useCreateUser,
  useUpdateUser,
  type StaffUser,
} from "@/features/settings/api/users";
import {
  userCreateSchema,
  userEditSchema,
  type UserCreateValues,
  type UserEditValues,
} from "@/features/settings/lib/schemas";
import { useAuth } from "@/lib/auth/AuthProvider";
import { GraphQLRequestError } from "@/lib/graphql/client";
import { ROLE_STYLES } from "@/lib/utils";
import type { Role } from "@/types";

/** A password that satisfies the policy first time, so nobody invents "Password1". */
function suggestPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = upper + lower + digits + symbols;
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);

  const pick = (set: string, n: number) => set[n % set.length] ?? set[0]!;
  // Guarantee one of each class, then fill.
  const chars = [
    pick(upper, bytes[0]!),
    pick(lower, bytes[1]!),
    pick(digits, bytes[2]!),
    pick(symbols, bytes[3]!),
    ...Array.from(bytes.slice(4), (n) => pick(all, n)),
  ];
  return chars.join("");
}

function roleOptions(actorRole: Role | undefined) {
  return assignableRoles(actorRole).map((role) => ({
    value: role,
    label: ROLE_STYLES[role].label,
  }));
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Invite a staff member.
 *
 * There is no "business" selector, and for an ADMIN there is no "Super admin"
 * role option — the server refuses both (app/services/user.py), so offering them
 * would only manufacture an error message.
 */
export function CreateUserDialog({ open, onOpenChange }: CreateUserDialogProps) {
  const { user } = useAuth();
  const createUser = useCreateUser();
  const options = roleOptions(user?.role);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<UserCreateValues>({
    resolver: zodResolver(userCreateSchema),
    defaultValues: { fullName: "", email: "", phone: "", password: "", role: "STAFF" },
  });

  useEffect(() => {
    if (open) reset({ fullName: "", email: "", phone: "", password: "", role: "STAFF" });
  }, [open, reset]);

  const password = watch("password");

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createUser.mutateAsync({
        email: values.email.trim().toLowerCase(),
        fullName: values.fullName.trim(),
        password: values.password,
        role: values.role,
        phone: values.phone.trim() === "" ? null : values.phone.trim(),
      });
      toast.success(`${values.fullName.trim()} can now sign in.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError ? error.message : "Could not create that user.",
      );
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite a user"
      description="They sign in with this email and password. Ask them to change it after their first login."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="create-user-form" isLoading={isSubmitting}>
            Create user
          </Button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField label="Full name" required error={errors.fullName?.message}>
          <Input {...register("fullName")} autoComplete="off" />
        </FormField>

        <FormField label="Email" required error={errors.email?.message}>
          <Input type="email" {...register("email")} autoComplete="off" />
        </FormField>

        <FormField label="Phone" error={errors.phone?.message}>
          <Input type="tel" {...register("phone")} autoComplete="off" />
        </FormField>

        <FormField
          label="Role"
          required
          description="Staff can record credits and payments. Admins can also change settings and manage users."
          error={errors.role?.message}
        >
          <Select {...register("role")} options={options} />
        </FormField>

        <div className="space-y-2">
          <FormField label="Temporary password" required error={errors.password?.message}>
            <Input type="text" {...register("password")} autoComplete="new-password" />
          </FormField>
          <div className="flex items-start justify-between gap-4">
            <PasswordStrength value={password} className="flex-1" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leftIcon={<RefreshCw />}
              onClick={() =>
                setValue("password", suggestPassword(), {
                  shouldValidate: true,
                  shouldDirty: true,
                })
              }
            >
              Generate
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------
export interface EditUserDialogProps {
  user: StaffUser | null;
  onOpenChange: (open: boolean) => void;
}

export function EditUserDialog({ user: target, onOpenChange }: EditUserDialogProps) {
  const { user: actor } = useAuth();
  const updateUser = useUpdateUser();
  const options = roleOptions(actor?.role);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<UserEditValues>({
    resolver: zodResolver(userEditSchema),
    defaultValues: { fullName: "", phone: "", role: "STAFF", isActive: true },
  });

  useEffect(() => {
    if (!target) return;
    reset({
      fullName: target.fullName,
      phone: target.phone ?? "",
      role: target.role,
      isActive: target.isActive,
    });
  }, [target, reset]);

  const isActive = watch("isActive");
  const isSelf = actor?.id === target?.id;

  const onSubmit = handleSubmit(async (values) => {
    if (!target) return;
    try {
      await updateUser.mutateAsync({
        id: target.id,
        input: {
          fullName: values.fullName.trim(),
          phone: values.phone.trim() === "" ? null : values.phone.trim(),
          role: values.role,
          isActive: values.isActive,
        },
      });
      toast.success("User updated.");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError ? error.message : "Could not update that user.",
      );
    }
  });

  return (
    <Dialog
      open={target !== null}
      onOpenChange={onOpenChange}
      title="Edit user"
      description={target?.email}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="edit-user-form" isLoading={isSubmitting}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-user-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField label="Full name" required error={errors.fullName?.message}>
          <Input {...register("fullName")} />
        </FormField>

        <FormField label="Phone" error={errors.phone?.message}>
          <Input type="tel" {...register("phone")} />
        </FormField>

        <FormField
          label="Role"
          required
          description={
            isSelf ? "This is your own account — changing your role can lock you out." : undefined
          }
          error={errors.role?.message}
        >
          <Select {...register("role")} options={options} />
        </FormField>

        <div className="border-border flex items-center justify-between gap-4 rounded-lg border p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Active</p>
            <p className="text-muted-foreground text-xs">
              An inactive user cannot sign in. Their records are kept.
            </p>
          </div>
          <Switch
            checked={isActive}
            onCheckedChange={(next) => setValue("isActive", next, { shouldDirty: true })}
            label="Account is active"
            disabled={isSelf}
          />
        </div>
      </form>
    </Dialog>
  );
}
