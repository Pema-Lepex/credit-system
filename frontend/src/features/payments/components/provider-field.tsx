"use client";

import { FormField, Input, Select } from "@/components/ui";
import {
  PAYMENT_PROVIDERS,
  PROVIDER_OTHER,
  providerApplies,
} from "@/features/payments/lib/providers";

export interface ProviderFieldProps {
  /** The currently selected payment method — decides whether this renders at all. */
  method: string;
  choice: string;
  custom: string;
  onChoiceChange: (value: string) => void;
  onCustomChange: (value: string) => void;
  error?: string;
  customError?: string;
}

/**
 * "Which bank or wallet?" — a picker plus a write-in.
 *
 * Shared by the two payment dialogs and the expense form, because a shop that
 * banks with Druk PNB banks with Druk PNB in all three, and three copies of the
 * list is three chances for one to go stale.
 *
 * Hidden entirely for CASH: a field that can only ever be blank is noise on the
 * form a shopkeeper fills in most often.
 */
export function ProviderField({
  method,
  choice,
  custom,
  onChoiceChange,
  onCustomChange,
  error,
  customError,
}: ProviderFieldProps) {
  if (!providerApplies(method)) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField
        label="Bank or wallet"
        error={error}
        description="Which one the money went through."
      >
        <Select
          value={choice}
          onChange={(event) => onChoiceChange(event.target.value)}
          options={[
            { value: "", label: "Not recorded" },
            ...PAYMENT_PROVIDERS.map((name) => ({ value: name, label: name })),
            { value: PROVIDER_OTHER, label: "Other…" },
          ]}
        />
      </FormField>

      {choice === PROVIDER_OTHER ? (
        <FormField
          label="Which one?"
          error={customError}
          description="Type the name and we will keep it."
        >
          <Input
            autoComplete="off"
            placeholder="e.g. My Local Credit Union"
            value={custom}
            onChange={(event) => onCustomChange(event.target.value)}
          />
        </FormField>
      ) : null}
    </div>
  );
}
