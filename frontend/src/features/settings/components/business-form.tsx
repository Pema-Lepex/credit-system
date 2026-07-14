"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Clock, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, type FieldPath } from "react-hook-form";

import {
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@/components/ui";
import {
  useBusiness,
  useUpdateBusiness,
  type BusinessSettings,
  type BusinessUpdateInput,
} from "@/features/settings/api/business";
import { ColorField } from "@/features/settings/components/color-field";
import { ImageUpload } from "@/features/settings/components/image-upload";
import { WorkingHoursEditor } from "@/features/settings/components/working-hours-editor";
import {
  CURRENCIES,
  LOCALES,
  currentTimeInZone,
  listTimezones,
  symbolForCurrency,
} from "@/features/settings/lib/locale-data";
import {
  businessSchema,
  emptyToNull,
  normaliseWorkingHours,
  numberOrNull,
  type BusinessFormValues,
} from "@/features/settings/lib/schemas";
import { useAuth } from "@/lib/auth/AuthProvider";
import { GraphQLRequestError } from "@/lib/graphql/client";

type TabId = "profile" | "contact" | "social" | "location" | "localisation" | "hours" | "branding";

/**
 * Which tab owns which field.
 *
 * Tab panels unmount when inactive (see ui/tabs.tsx), so a validation error on
 * the Location tab is invisible while the user stares at the Profile tab pressing
 * Save. On an invalid submit we look the offending field up here and switch to
 * its tab — otherwise the form just refuses to save and never says why.
 */
const FIELD_TABS: Record<FieldPath<BusinessFormValues>, TabId> = {
  name: "profile",
  description: "profile",
  logoFileId: "profile",
  email: "contact",
  phone: "contact",
  whatsappNumber: "contact",
  website: "contact",
  facebookUrl: "social",
  instagramUrl: "social",
  tiktokUrl: "social",
  address: "location",
  city: "location",
  country: "location",
  googleMapsUrl: "location",
  latitude: "location",
  longitude: "location",
  currency: "localisation",
  currencySymbol: "localisation",
  timezone: "localisation",
  locale: "localisation",
  taxPercentage: "localisation",
  workingHours: "hours",
  brandColor: "branding",
  emailFromName: "branding",
  emailReplyTo: "branding",
  emailSignature: "branding",
} as Record<FieldPath<BusinessFormValues>, TabId>;

function toFormValues(business: BusinessSettings): BusinessFormValues {
  return {
    name: business.name,
    description: business.description ?? "",
    logoFileId: null, // only ever set by a fresh upload
    email: business.email ?? "",
    phone: business.phone ?? "",
    whatsappNumber: business.whatsappNumber ?? "",
    website: business.website ?? "",
    facebookUrl: business.facebookUrl ?? "",
    instagramUrl: business.instagramUrl ?? "",
    tiktokUrl: business.tiktokUrl ?? "",
    address: business.address ?? "",
    city: business.city ?? "",
    country: business.country ?? "",
    googleMapsUrl: business.googleMapsUrl ?? "",
    latitude: business.latitude === null ? "" : String(business.latitude),
    longitude: business.longitude === null ? "" : String(business.longitude),
    currency: business.currency,
    currencySymbol: business.currencySymbol,
    timezone: business.timezone,
    locale: business.locale,
    taxPercentage: business.taxPercentage ?? "0",
    workingHours: normaliseWorkingHours(business.workingHours),
    brandColor: business.brandColor,
    emailFromName: business.emailFromName ?? "",
    emailReplyTo: business.emailReplyTo ?? "",
    emailSignature: business.emailSignature ?? "",
  };
}

function toInput(values: BusinessFormValues, logoRemoved: boolean): BusinessUpdateInput {
  return {
    name: values.name.trim(),
    description: emptyToNull(values.description),
    // null clears the logo; undefined leaves it alone. A fresh upload wins.
    logoFileId: values.logoFileId ?? (logoRemoved ? null : undefined),
    email: emptyToNull(values.email),
    phone: emptyToNull(values.phone),
    whatsappNumber: emptyToNull(values.whatsappNumber),
    website: emptyToNull(values.website),
    facebookUrl: emptyToNull(values.facebookUrl),
    instagramUrl: emptyToNull(values.instagramUrl),
    tiktokUrl: emptyToNull(values.tiktokUrl),
    address: emptyToNull(values.address),
    city: emptyToNull(values.city),
    country: emptyToNull(values.country),
    googleMapsUrl: emptyToNull(values.googleMapsUrl),
    latitude: numberOrNull(values.latitude),
    longitude: numberOrNull(values.longitude),
    currency: values.currency.trim().toUpperCase(),
    currencySymbol: values.currencySymbol.trim(),
    timezone: values.timezone,
    locale: values.locale,
    // Money and percentages stay strings all the way to the server.
    taxPercentage: values.taxPercentage.trim() === "" ? "0" : values.taxPercentage.trim(),
    workingHours: values.workingHours,
    brandColor: values.brandColor,
    emailFromName: emptyToNull(values.emailFromName),
    emailReplyTo: emptyToNull(values.emailReplyTo),
    emailSignature: emptyToNull(values.emailSignature),
  };
}

export function BusinessForm() {
  const { data: business, isLoading, isError, error } = useBusiness();
  const updateBusiness = useUpdateBusiness();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("business:update");

  const [tab, setTab] = useState<TabId>("profile");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);

  const timezones = useMemo(() => listTimezones(), []);

  const form = useForm<BusinessFormValues>({
    resolver: zodResolver(businessSchema),
    // The real values arrive from the query; reset() below installs them.
    defaultValues: {
      name: "",
      description: "",
      logoFileId: null,
      email: "",
      phone: "",
      whatsappNumber: "",
      website: "",
      facebookUrl: "",
      instagramUrl: "",
      tiktokUrl: "",
      address: "",
      city: "",
      country: "",
      googleMapsUrl: "",
      latitude: "",
      longitude: "",
      currency: "USD",
      currencySymbol: "$",
      timezone: "UTC",
      locale: "en-US",
      taxPercentage: "0",
      workingHours: normaliseWorkingHours(undefined),
      brandColor: "#4f46e5",
      emailFromName: "",
      emailReplyTo: "",
      emailSignature: "",
    },
  });

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    watch,
    formState: { errors, isDirty, isSubmitting },
  } = form;

  useEffect(() => {
    if (!business) return;
    reset(toFormValues(business));
    setLogoUrl(business.logoUrl ?? null);
    setLogoRemoved(false);
  }, [business, reset]);

  const timezone = watch("timezone");
  const zoneTime = currentTimeInZone(timezone);

  const onSubmit = handleSubmit(
    async (values) => {
      try {
        const updated = await updateBusiness.mutateAsync(toInput(values, logoRemoved));
        reset(toFormValues(updated));
        setLogoUrl(updated.logoUrl ?? null);
        setLogoRemoved(false);
        toast.success("Business settings saved.");
      } catch (err) {
        toast.error(
          err instanceof GraphQLRequestError ? err.message : "Could not save your changes.",
        );
      }
    },
    (fieldErrors) => {
      // Jump to the first tab that actually has a problem on it.
      const first = Object.keys(fieldErrors)[0] as FieldPath<BusinessFormValues> | undefined;
      const target = first ? FIELD_TABS[first] : undefined;
      if (target) setTab(target);
      toast.error("Some fields need fixing before this can be saved.");
    },
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <SkeletonText lines={8} />
        </CardContent>
      </Card>
    );
  }

  if (isError || !business) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive-soft-foreground text-sm">
            {error instanceof Error ? error.message : "Could not load your business settings."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <Tabs value={tab} defaultValue="profile" onValueChange={(v) => setTab(v as TabId)}>
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="contact">Contact</TabsTrigger>
            <TabsTrigger value="social">Social</TabsTrigger>
            <TabsTrigger value="location">Location</TabsTrigger>
            <TabsTrigger value="localisation">Localisation</TabsTrigger>
            <TabsTrigger value="hours">Working hours</TabsTrigger>
            <TabsTrigger value="branding">Branding</TabsTrigger>
          </TabsList>
        </div>

        {/* ------------------------------------------------------------ profile */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>
                Your name and logo appear on invoices, receipts and every email you send.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <ImageUpload
                label="Logo"
                description="PNG, JPG, WebP or SVG. Up to 5 MB — larger images are compressed automatically."
                kind="BUSINESS_LOGO"
                currentUrl={logoUrl}
                onUploaded={(fileId, url) => {
                  setValue("logoFileId", fileId, { shouldDirty: true });
                  setLogoUrl(url);
                  setLogoRemoved(false);
                }}
                onRemoved={() => {
                  setValue("logoFileId", null, { shouldDirty: true });
                  setLogoUrl(null);
                  setLogoRemoved(true);
                }}
              />

              <FormField label="Business name" required error={errors.name?.message}>
                <Input {...register("name")} disabled={!canEdit} autoComplete="organization" />
              </FormField>

              <FormField
                label="Description"
                description="A sentence about what you do. Shown on receipts."
                error={errors.description?.message}
              >
                <Textarea rows={3} {...register("description")} disabled={!canEdit} />
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------ contact */}
        <TabsContent value="contact">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
              <CardDescription>How customers reach you.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <FormField label="Email" error={errors.email?.message}>
                <Input type="email" {...register("email")} disabled={!canEdit} autoComplete="email" />
              </FormField>
              <FormField label="Phone" error={errors.phone?.message}>
                <Input type="tel" {...register("phone")} disabled={!canEdit} autoComplete="tel" />
              </FormField>
              <FormField
                label="WhatsApp number"
                description="Include the country code."
                error={errors.whatsappNumber?.message}
              >
                <Input type="tel" {...register("whatsappNumber")} disabled={!canEdit} />
              </FormField>
              <FormField label="Website" error={errors.website?.message}>
                <Input
                  type="url"
                  placeholder="https://example.com"
                  {...register("website")}
                  disabled={!canEdit}
                />
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------- social */}
        <TabsContent value="social">
          <Card>
            <CardHeader>
              <CardTitle>Social</CardTitle>
              <CardDescription>Optional. Leave a field blank to hide that link.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <FormField label="Facebook" error={errors.facebookUrl?.message}>
                <Input
                  type="url"
                  placeholder="https://facebook.com/…"
                  {...register("facebookUrl")}
                  disabled={!canEdit}
                />
              </FormField>
              <FormField label="Instagram" error={errors.instagramUrl?.message}>
                <Input
                  type="url"
                  placeholder="https://instagram.com/…"
                  {...register("instagramUrl")}
                  disabled={!canEdit}
                />
              </FormField>
              <FormField label="TikTok" error={errors.tiktokUrl?.message}>
                <Input
                  type="url"
                  placeholder="https://tiktok.com/@…"
                  {...register("tiktokUrl")}
                  disabled={!canEdit}
                />
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----------------------------------------------------------- location */}
        <TabsContent value="location">
          <Card>
            <CardHeader>
              <CardTitle>Location</CardTitle>
              <CardDescription>
                Where you are. Coordinates are optional — they only matter if you want a pin on a
                map.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <FormField label="Address" error={errors.address?.message} className="sm:col-span-2">
                <Input
                  {...register("address")}
                  disabled={!canEdit}
                  autoComplete="street-address"
                />
              </FormField>
              <FormField label="City" error={errors.city?.message}>
                <Input {...register("city")} disabled={!canEdit} autoComplete="address-level2" />
              </FormField>
              <FormField label="Country" error={errors.country?.message}>
                <Input {...register("country")} disabled={!canEdit} autoComplete="country-name" />
              </FormField>
              <FormField
                label="Google Maps URL"
                error={errors.googleMapsUrl?.message}
                className="sm:col-span-2"
              >
                <Input
                  type="url"
                  placeholder="https://maps.app.goo.gl/…"
                  {...register("googleMapsUrl")}
                  disabled={!canEdit}
                />
              </FormField>
              <FormField label="Latitude" error={errors.latitude?.message}>
                <Input
                  inputMode="decimal"
                  placeholder="27.4712"
                  {...register("latitude")}
                  disabled={!canEdit}
                />
              </FormField>
              <FormField label="Longitude" error={errors.longitude?.message}>
                <Input
                  inputMode="decimal"
                  placeholder="89.6339"
                  {...register("longitude")}
                  disabled={!canEdit}
                />
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------- localisation */}
        <TabsContent value="localisation">
          <Card>
            <CardHeader>
              <CardTitle>Localisation</CardTitle>
              <CardDescription>
                Currency, timezone and locale decide how money and dates are shown everywhere in
                the app.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <FormField
                label="Currency"
                required
                description="ISO code, e.g. USD, EUR, BTN."
                error={errors.currency?.message}
              >
                <Input
                  list="currency-codes"
                  autoCapitalize="characters"
                  spellCheck={false}
                  disabled={!canEdit}
                  {...register("currency", {
                    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                      // Prefill the symbol when the code becomes valid — the owner
                      // can still override it (some shops write "Nu." not "BTN").
                      const code = event.target.value.trim().toUpperCase();
                      if (/^[A-Z]{3}$/.test(code)) {
                        setValue("currencySymbol", symbolForCurrency(code, getValues("locale")), {
                          shouldDirty: true,
                        });
                      }
                    },
                  })}
                />
              </FormField>
              <datalist id="currency-codes">
                {CURRENCIES.map((code) => (
                  <option key={code} value={code} />
                ))}
              </datalist>

              <FormField
                label="Currency symbol"
                required
                error={errors.currencySymbol?.message}
              >
                <Input {...register("currencySymbol")} disabled={!canEdit} />
              </FormField>

              <FormField
                label="Timezone"
                required
                description={
                  zoneTime ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="size-3" aria-hidden="true" />
                      It is {zoneTime} there right now.
                    </span>
                  ) : (
                    "Start typing a city, e.g. Asia/Thimphu."
                  )
                }
                error={errors.timezone?.message}
              >
                <Input
                  list="iana-timezones"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={!canEdit}
                  {...register("timezone")}
                />
              </FormField>
              <datalist id="iana-timezones">
                {timezones.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>

              <FormField label="Locale" required error={errors.locale?.message}>
                <Select
                  {...register("locale")}
                  disabled={!canEdit}
                  options={LOCALES.map((l) => ({ value: l.value, label: l.label }))}
                />
              </FormField>

              <FormField
                label="Tax percentage"
                description="Applied by default to new credits. Use 0 for none."
                error={errors.taxPercentage?.message}
              >
                <Input
                  inputMode="decimal"
                  rightAddon={<span className="text-xs">%</span>}
                  {...register("taxPercentage")}
                  disabled={!canEdit}
                />
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------------------------------------- hours */}
        <TabsContent value="hours">
          <Card>
            <CardHeader>
              <CardTitle>Working hours</CardTitle>
              <CardDescription>
                Shown to customers on receipts and reminders. Turn a day off to mark it closed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Controller
                control={control}
                name="workingHours"
                render={({ field }) => (
                  <WorkingHoursEditor
                    value={field.value}
                    onChange={field.onChange}
                    disabled={!canEdit}
                  />
                )}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----------------------------------------------------------- branding */}
        <TabsContent value="branding">
          <Card>
            <CardHeader>
              <CardTitle>Branding</CardTitle>
              <CardDescription>
                Your brand colour and the identity your emails are sent under.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <FormField
                label="Brand colour"
                description="Used as the accent in emails and PDFs."
                error={errors.brandColor?.message}
              >
                <Controller
                  control={control}
                  name="brandColor"
                  render={({ field }) => (
                    <ColorField
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      disabled={!canEdit}
                      invalid={Boolean(errors.brandColor)}
                    />
                  )}
                />
              </FormField>

              <FormField
                label="Email from-name"
                description="The name customers see in their inbox."
                error={errors.emailFromName?.message}
              >
                <Input {...register("emailFromName")} disabled={!canEdit} />
              </FormField>

              <FormField
                label="Reply-to address"
                description="Where replies to your emails land."
                error={errors.emailReplyTo?.message}
              >
                <Input type="email" {...register("emailReplyTo")} disabled={!canEdit} />
              </FormField>

              <FormField
                label="Email signature"
                error={errors.emailSignature?.message}
                className="sm:col-span-2"
              >
                <Textarea rows={3} {...register("emailSignature")} disabled={!canEdit} />
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* One save button for the whole form: the tabs are a view, not seven forms. */}
      <div className="border-border bg-background/80 sticky bottom-0 flex flex-col gap-3 border-t py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {!canEdit
            ? "You have read-only access to these settings."
            : isDirty
              ? "You have unsaved changes."
              : "Everything is saved."}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!isDirty || isSubmitting}
            onClick={() => {
              reset(toFormValues(business));
              setLogoUrl(business.logoUrl ?? null);
              setLogoRemoved(false);
            }}
          >
            Discard
          </Button>
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
      </div>
    </form>
  );
}
