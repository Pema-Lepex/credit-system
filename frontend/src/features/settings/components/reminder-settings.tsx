"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";

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
  SkeletonText,
  Switch,
  toast,
} from "@/components/ui";
import { useBusiness, useUpdateBusiness } from "@/features/settings/api/business";
import { formatHourInZone } from "@/features/settings/lib/locale-data";
import { remindersSchema, type RemindersValues } from "@/features/settings/lib/schemas";
import { useAuth } from "@/lib/auth/AuthProvider";
import { GraphQLRequestError } from "@/lib/graphql/client";
import { cn } from "@/lib/utils";
import type { ReminderAudience } from "@/types";

const PRESETS = [1, 3, 7] as const;

const AUDIENCE_OPTIONS: { value: ReminderAudience; label: string }[] = [
  { value: "CUSTOMER", label: "The customer" },
  { value: "OWNER", label: "You (the business)" },
  { value: "BOTH", label: "Both the customer and you" },
];

/**
 * The reminder settings — a slice of the Business row, saved with `updateBusiness`.
 *
 * The delivery warning below is the important part of this file. See
 * <CustomerDeliveryWarning>.
 */
export function ReminderSettings() {
  const { data: business, isLoading } = useBusiness();
  const updateBusiness = useUpdateBusiness();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("business:update");

  const [customDay, setCustomDay] = useState("");

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<RemindersValues>({
    resolver: zodResolver(remindersSchema),
    defaultValues: {
      remindersEnabled: true,
      reminderDaysBefore: [3],
      reminderAudience: "BOTH",
      reminderSendHour: 9,
      notifyOwnerOnOverdue: true,
      notifyOwnerOnPayment: true,
    },
  });

  useEffect(() => {
    if (!business) return;
    reset({
      remindersEnabled: business.remindersEnabled,
      reminderDaysBefore: [...business.reminderDaysBefore].sort((a, b) => b - a),
      reminderAudience: business.reminderAudience,
      reminderSendHour: business.reminderSendHour,
      notifyOwnerOnOverdue: business.notifyOwnerOnOverdue,
      notifyOwnerOnPayment: business.notifyOwnerOnPayment,
    });
  }, [business, reset]);

  const days = watch("reminderDaysBefore");
  const audience = watch("reminderAudience");
  const enabled = watch("remindersEnabled");
  const sendHour = watch("reminderSendHour");

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.locale ?? "en-US";

  const toggleDay = (day: number) => {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
    setValue("reminderDaysBefore", [...next].sort((a, b) => b - a), {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const addCustomDay = () => {
    const value = Number(customDay);
    if (!Number.isInteger(value) || value < 0 || value > 365) {
      toast.error("Enter a whole number of days between 0 and 365.");
      return;
    }
    if (days.includes(value)) {
      toast.error(`A reminder ${value} days before is already set.`);
      return;
    }
    setValue("reminderDaysBefore", [...days, value].sort((a, b) => b - a), {
      shouldDirty: true,
      shouldValidate: true,
    });
    setCustomDay("");
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      await updateBusiness.mutateAsync({
        remindersEnabled: values.remindersEnabled,
        reminderDaysBefore: values.reminderDaysBefore,
        reminderAudience: values.reminderAudience,
        reminderSendHour: values.reminderSendHour,
        notifyOwnerOnOverdue: values.notifyOwnerOnOverdue,
        notifyOwnerOnPayment: values.notifyOwnerOnPayment,
      });
      toast.success("Reminder settings saved.");
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError ? error.message : "Could not save your changes.",
      );
    }
  });

  if (isLoading || !business) {
    return (
      <Card>
        <CardContent className="pt-6">
          <SkeletonText lines={6} />
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {audience !== "OWNER" && enabled ? <CustomerDeliveryWarning /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Reminders</CardTitle>
          <CardDescription>
            Automatic nudges before a credit falls due, and alerts for you when things change.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="border-border flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Send reminders</p>
              <p className="text-muted-foreground text-xs">
                Turn this off and nothing is scheduled or sent.
              </p>
            </div>
            <Controller
              control={control}
              name="remindersEnabled"
              render={({ field }) => (
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={!canEdit}
                  label="Send reminders"
                />
              )}
            />
          </div>

          <fieldset disabled={!enabled || !canEdit} className="space-y-6 disabled:opacity-60">
            {/* ------------------------------------------------------ days before */}
            <div className="space-y-2">
              <p className="text-foreground text-sm font-medium">Remind how many days before?</p>
              <p className="text-muted-foreground text-xs">
                A reminder goes out on each of these days. 0 means on the due date itself.
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {PRESETS.map((preset) => {
                  const active = days.includes(preset);
                  return (
                    <button
                      key={preset}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleDay(preset)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                        "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
                        active
                          ? "border-primary bg-primary-soft text-primary-soft-foreground"
                          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {preset} day{preset === 1 ? "" : "s"} before
                    </button>
                  );
                })}
              </div>

              {/* Custom days beyond the presets, shown as removable chips. */}
              {days.filter((d) => !PRESETS.includes(d as (typeof PRESETS)[number])).length > 0 ? (
                <ul className="flex flex-wrap gap-2 pt-1">
                  {days
                    .filter((d) => !PRESETS.includes(d as (typeof PRESETS)[number]))
                    .map((day) => (
                      <li key={day}>
                        <span className="bg-primary-soft text-primary-soft-foreground inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium">
                          {day === 0 ? "On the due date" : `${day} days before`}
                          <button
                            type="button"
                            onClick={() => toggleDay(day)}
                            aria-label={`Remove the ${day}-day reminder`}
                            className="hover:bg-primary/20 focus-visible:ring-ring rounded-sm p-0.5 focus-visible:ring-2 focus-visible:outline-none"
                          >
                            <X className="size-3" aria-hidden="true" />
                          </button>
                        </span>
                      </li>
                    ))}
                </ul>
              ) : null}

              <div className="flex items-end gap-2 pt-1">
                <FormField label="Add another" className="w-40">
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    inputSize="sm"
                    placeholder="e.g. 14"
                    value={customDay}
                    onChange={(event) => setCustomDay(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        // Enter in a bare number field would submit the whole form.
                        event.preventDefault();
                        addCustomDay();
                      }
                    }}
                  />
                </FormField>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  leftIcon={<Plus />}
                  onClick={addCustomDay}
                >
                  Add
                </Button>
              </div>

              {errors.reminderDaysBefore ? (
                <p role="alert" className="text-destructive-soft-foreground text-xs font-medium">
                  {errors.reminderDaysBefore.message}
                </p>
              ) : null}
            </div>

            {/* -------------------------------------------------- audience + hour */}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Who gets the reminder?"
                error={errors.reminderAudience?.message}
              >
                <Controller
                  control={control}
                  name="reminderAudience"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onChange={(event) =>
                        field.onChange(event.target.value as ReminderAudience)
                      }
                      options={AUDIENCE_OPTIONS}
                    />
                  )}
                />
              </FormField>

              <FormField
                label="Send at"
                description={`${formatHourInZone(sendHour, timezone, locale)} in ${timezone}, your business timezone.`}
                error={errors.reminderSendHour?.message}
              >
                <Controller
                  control={control}
                  name="reminderSendHour"
                  render={({ field }) => (
                    <Select
                      value={String(field.value)}
                      onChange={(event) => field.onChange(Number(event.target.value))}
                      options={Array.from({ length: 24 }, (_, hour) => ({
                        value: String(hour),
                        label: formatHourInZone(hour, timezone, locale),
                      }))}
                    />
                  )}
                />
              </FormField>
            </div>
          </fieldset>

          {/* -------------------------------------------------- owner notifications */}
          <div className="space-y-3">
            <p className="text-foreground text-sm font-medium">Notify me when…</p>

            <div className="border-border flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">A credit goes overdue</p>
                <p className="text-muted-foreground text-xs">
                  Sent to you, so it always arrives regardless of email provider.
                </p>
              </div>
              <Controller
                control={control}
                name="notifyOwnerOnOverdue"
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={!canEdit}
                    label="Notify me when a credit goes overdue"
                  />
                )}
              />
            </div>

            <div className="border-border flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">A payment is received</p>
                <p className="text-muted-foreground text-xs">
                  A note in your inbox whenever money comes in.
                </p>
              </div>
              <Controller
                control={control}
                name="notifyOwnerOnPayment"
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={!canEdit}
                    label="Notify me when a payment is received"
                  />
                )}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {!canEdit
            ? "You have read-only access to these settings."
            : isDirty
              ? "You have unsaved changes."
              : "Everything is saved."}
        </p>
        <Button
          type="submit"
          leftIcon={<Save />}
          isLoading={isSubmitting}
          loadingText="Saving…"
          disabled={!canEdit || !isDirty}
        >
          Save changes
        </Button>
      </div>
    </form>
  );
}

/**
 * *** THE HONEST WARNING ***
 *
 * The backend's default email provider is W3Forms, a form-to-email relay that can
 * only deliver to the inbox registered against the access key. It physically
 * cannot email a customer. Rather than pretend, the backend refuses the send and
 * records the reminder as FAILED with an explanation
 * (backend/app/email/service.py::_capability_error).
 *
 * A shopkeeper who believes their customers were reminded when they were not is
 * the worst failure this product can have — worse than an error message, because
 * they find out when the customer doesn't pay. So we say it plainly, up front,
 * where the audience is chosen, and we say it calmly: this is a configuration
 * step, not a catastrophe.
 *
 * We cannot query the provider (the GraphQL schema does not expose it), so we
 * cannot say "your provider IS W3Forms" — only what the requirement is. The
 * reminder queue below tells the rest of the truth: every FAILED row shows the
 * real error the server recorded.
 */
function CustomerDeliveryWarning() {
  return (
    <Alert variant="warning" title="Customer emails need SMTP configured">
      <p>
        Reminders addressed to <strong>customers</strong> can only be delivered if your server is
        configured with SMTP. On the default free email relay (W3Forms), mail can only be sent to
        your own registered inbox — a message to a customer is refused, and the reminder is
        recorded as <strong>Failed</strong> in the queue below, with the reason.
      </p>
      <p className="mt-2">
        Reminders addressed to <strong>you</strong> always work. To reach customers, ask whoever
        runs your server to set <code className="font-mono text-xs">EMAIL_PROVIDER=smtp</code>.
        Nothing else needs to change.
      </p>
    </Alert>
  );
}
