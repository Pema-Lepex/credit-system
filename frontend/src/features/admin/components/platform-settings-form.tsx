"use client";

import { KeyRound, Mail } from "lucide-react";
import { useState } from "react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Skeleton,
  toast,
} from "@/components/ui";
import { PasswordInput } from "@/components/auth/password-input";
import { usePlatformSettings, useUpdatePlatformSettings } from "@/features/admin/api";
import { GraphQLRequestError } from "@/lib/graphql/client";

/**
 * Lets the super-admin set the W3Forms access key used to email them when a new
 * store owner registers. The key is write-only: the API returns only whether one is
 * set and a masked tail (e.g. ••••••••a1b2), never the value. Saving sends the new
 * key; clearing sends an empty string; typing nothing and saving leaves it as-is.
 */
export function PlatformSettingsForm() {
  const { data, isLoading, isError, error } = usePlatformSettings();
  const update = useUpdatePlatformSettings();
  const [value, setValue] = useState("");

  const save = async () => {
    const key = value.trim();
    if (!key) {
      toast.error("Enter a key, or use “Remove key” to clear it.");
      return;
    }
    try {
      await update.mutateAsync({ w3formsAccessKey: key });
      setValue("");
      toast.success("W3Forms key saved.");
    } catch (err) {
      toast.error(err instanceof GraphQLRequestError ? err.message : "Could not save the key.");
    }
  };

  const clear = async () => {
    try {
      await update.mutateAsync({ w3formsAccessKey: "" });
      setValue("");
      toast.success("W3Forms key removed.");
    } catch (err) {
      toast.error(err instanceof GraphQLRequestError ? err.message : "Could not remove the key.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" aria-hidden="true" />
          W3Forms notification key
        </CardTitle>
        <CardDescription>
          Used to email you when a new store owner registers. The key’s registered
          inbox on web3forms.com must be your own email address. It is stored securely
          and never shown again after you save it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : isError ? (
          <p className="text-destructive-soft-foreground text-sm">
            {error instanceof Error ? error.message : "Could not load platform settings."}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm">
              <Mail className="text-muted-foreground size-4" aria-hidden="true" />
              <span className="text-muted-foreground">Current key:</span>
              {data?.hasW3formsAccessKey ? (
                <Badge variant="success" dot>
                  Set{data.w3formsAccessKeyHint ? ` · ${data.w3formsAccessKeyHint}` : ""}
                </Badge>
              ) : (
                <Badge variant="neutral" dot>
                  Not set
                </Badge>
              )}
            </div>

            <FormField
              label={data?.hasW3formsAccessKey ? "Replace key" : "Access key"}
              description="Paste the access key from your web3forms.com dashboard."
            >
              <PasswordInput
                autoComplete="off"
                placeholder="e.g. 59739ddd-0163-4db5-aa6c-700a8bba22f2"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </FormField>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={save}
                isLoading={update.isPending}
                disabled={value.trim().length === 0}
              >
                Save key
              </Button>
              {data?.hasW3formsAccessKey ? (
                <Button variant="outline" onClick={clear} disabled={update.isPending}>
                  Remove key
                </Button>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
