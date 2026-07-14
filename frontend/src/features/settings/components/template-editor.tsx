"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  FormField,
  Input,
  Select,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from "@/components/ui";
import { useBusiness } from "@/features/settings/api/business";
import {
  useEmailTemplates,
  useResetEmailTemplate,
  useServerPreview,
  useTemplateVariables,
  useUpdateEmailTemplate,
  type EmailTemplateSummary,
} from "@/features/settings/api/templates";
import { ColorField } from "@/features/settings/components/color-field";
import { TemplateVariableChips } from "@/features/settings/components/template-variable-chips";
import { absoluteUrl } from "@/features/settings/lib/http";
import {
  renderEmailPreview,
  renderSubjectPreview,
} from "@/features/settings/lib/render-preview";
import {
  emailTemplateSchema,
  type EmailTemplateValues,
} from "@/features/settings/lib/schemas";
import { useAuth } from "@/lib/auth/AuthProvider";
import { GraphQLRequestError } from "@/lib/graphql/client";
import { formatRelativeDate } from "@/lib/utils";
import { EMAIL_TEMPLATE_KINDS, type EmailTemplateKind } from "@/types";

const KIND_LABELS: Record<EmailTemplateKind, string> = {
  REMINDER: "Payment reminder",
  RECEIPT: "Receipt",
  PAYMENT_CONFIRMATION: "Payment confirmation",
  WELCOME: "Welcome",
  ADMIN_NOTIFICATION: "Owner notification",
  OVERDUE_NOTICE: "Overdue notice",
  DATA_DELETION_WARNING: "Data deletion warning",
};

const KIND_DESCRIPTIONS: Record<EmailTemplateKind, string> = {
  REMINDER: "Sent before a credit falls due.",
  RECEIPT: "Sent when you record a payment.",
  PAYMENT_CONFIRMATION: "Confirms a payment has cleared.",
  WELCOME: "Sent to a new customer.",
  ADMIN_NOTIFICATION: "Sent to you, not to the customer.",
  OVERDUE_NOTICE: "Sent once a credit is past its due date.",
  DATA_DELETION_WARNING: "Warns before archived records are deleted for good.",
};

/** Which field the cursor was last in — that is where a variable chip inserts. */
type ActiveField = "subject" | "bodyHtml" | "footerHtml" | "signature";

type PreviewMode = "live" | "saved";

function toFormValues(template: EmailTemplateSummary): EmailTemplateValues {
  return {
    subject: template.subject,
    bodyHtml: template.bodyHtml,
    footerHtml: template.footerHtml ?? "",
    signature: template.signature ?? "",
    primaryColor: template.primaryColor ?? "#4f46e5",
    accentColor: template.accentColor ?? "#0284c7",
    showLogo: template.showLogo,
    isActive: template.isActive,
  };
}

export function TemplateEditor() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("template:write");

  const [kind, setKind] = useState<EmailTemplateKind>("REMINDER");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("live");
  const [isResetOpen, setResetOpen] = useState(false);
  const activeField = useRef<ActiveField>("bodyHtml");

  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const footerRef = useRef<HTMLTextAreaElement | null>(null);
  const signatureRef = useRef<HTMLTextAreaElement | null>(null);

  const { data: templates, isLoading: templatesLoading } = useEmailTemplates();
  const { data: business } = useBusiness();
  const { data: variables } = useTemplateVariables(kind);
  const updateTemplate = useUpdateEmailTemplate();
  const resetTemplate = useResetEmailTemplate();

  const template = templates?.find((t) => t.kind === kind);

  const serverPreview = useServerPreview(kind, previewMode === "saved");

  const form = useForm<EmailTemplateValues>({
    resolver: zodResolver(emailTemplateSchema),
    defaultValues: {
      subject: "",
      bodyHtml: "",
      footerHtml: "",
      signature: "",
      primaryColor: "#4f46e5",
      accentColor: "#0284c7",
      showLogo: true,
      isActive: true,
    },
  });

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isDirty, isSubmitting },
  } = form;

  useEffect(() => {
    if (template) reset(toFormValues(template));
  }, [template, reset]);

  const values = watch();

  /**
   * Registered once, so the ref callback can hand the node to BOTH React Hook Form
   * (which needs it to read the value) and our own ref (which needs it to read the
   * caret position for variable insertion).
   */
  const subjectReg = register("subject");
  const bodyReg = register("bodyHtml");
  const signatureReg = register("signature");
  const footerReg = register("footerHtml");

  /** name -> example, straight from `templateVariables(kind)`. */
  const samples = useMemo(() => {
    const map: Record<string, string> = {};
    for (const variable of variables ?? []) map[variable.name] = variable.example;
    // The business's own fields are always available to every template.
    if (business) {
      map.business_name ??= business.name;
      map.business_phone ??= business.phone ?? "";
      map.business_email ??= business.email ?? "";
      map.business_address ??= business.address ?? "";
    }
    return map;
  }, [variables, business]);

  const previewBusiness = useMemo(
    () => ({
      name: business?.name ?? "Your business",
      logoUrl: absoluteUrl(business?.logoUrl) ?? null,
      brandColor: business?.brandColor ?? "#4f46e5",
      phone: business?.phone ?? null,
      email: business?.email ?? null,
      address: business?.address ?? null,
    }),
    [business],
  );

  const liveHtml = useMemo(
    () =>
      renderEmailPreview(
        {
          subject: values.subject,
          bodyHtml: values.bodyHtml,
          footerHtml: values.footerHtml,
          signature: values.signature,
          primaryColor: values.primaryColor,
          accentColor: values.accentColor,
          showLogo: values.showLogo,
        },
        previewBusiness,
        samples,
      ),
    [values, previewBusiness, samples],
  );

  const previewHtml =
    previewMode === "saved" ? (serverPreview.data ?? "<p>Loading…</p>") : liveHtml;

  /**
   * Insert `{{name}}` at the cursor of whichever field was last focused.
   *
   * This is what makes the editor usable — the alternative is remembering that
   * the variable is `customer_name` and not `customerName`, and typing it by hand
   * into an HTML blob. The selection is restored after the state update so the
   * user can keep typing exactly where they left off.
   */
  const insertVariable = useCallback(
    (name: string) => {
      const field = activeField.current;
      const element =
        field === "subject"
          ? subjectRef.current
          : field === "footerHtml"
            ? footerRef.current
            : field === "signature"
              ? signatureRef.current
              : bodyRef.current;

      const token = `{{${name}}}`;
      const current = values[field] ?? "";

      if (!element) {
        setValue(field, `${current}${token}`, { shouldDirty: true, shouldValidate: true });
        return;
      }

      const start = element.selectionStart ?? current.length;
      const end = element.selectionEnd ?? start;
      const next = `${current.slice(0, start)}${token}${current.slice(end)}`;

      setValue(field, next, { shouldDirty: true, shouldValidate: true });

      // The DOM value is rewritten by React on the next paint; move the caret
      // after that, or it snaps to the end of the field.
      requestAnimationFrame(() => {
        element.focus();
        const caret = start + token.length;
        element.setSelectionRange(caret, caret);
      });
    },
    [values, setValue],
  );

  const onSubmit = handleSubmit(async (formValues) => {
    try {
      await updateTemplate.mutateAsync({
        kind,
        input: {
          subject: formValues.subject.trim(),
          bodyHtml: formValues.bodyHtml,
          footerHtml: formValues.footerHtml.trim() === "" ? null : formValues.footerHtml,
          signature: formValues.signature.trim() === "" ? null : formValues.signature,
          primaryColor: formValues.primaryColor,
          accentColor: formValues.accentColor,
          showLogo: formValues.showLogo,
          isActive: formValues.isActive,
        },
      });
      toast.success(`${KIND_LABELS[kind]} template saved.`);
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError ? error.message : "Could not save the template.",
      );
    }
  });

  const onReset = async () => {
    try {
      const restored = await resetTemplate.mutateAsync(kind);
      reset(toFormValues(restored));
      setResetOpen(false);
      toast.success("Template restored to the original.");
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError ? error.message : "Could not reset the template.",
      );
    }
  };

  if (templatesLoading) {
    return <Skeleton className="h-[32rem] w-full" />;
  }

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------- kind selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <FormField
          label="Template"
          description={KIND_DESCRIPTIONS[kind]}
          className="sm:max-w-sm sm:flex-1"
        >
          <Select
            value={kind}
            onChange={(event) => setKind(event.target.value as EmailTemplateKind)}
            options={EMAIL_TEMPLATE_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
          />
        </FormField>

        <div className="flex flex-wrap items-center gap-2">
          {template ? (
            <Badge variant={template.isDefault ? "neutral" : "info"} dot>
              {template.isDefault ? "Original" : "Edited"}
            </Badge>
          ) : null}
          {template && !template.isDefault ? (
            <span className="text-muted-foreground text-xs">
              Changed {formatRelativeDate(template.updatedAt)}
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RotateCcw />}
            disabled={!canEdit || template?.isDefault}
            onClick={() => setResetOpen(true)}
          >
            Reset to default
          </Button>
        </div>
      </div>

      {/* --------------------------------------------------------- split pane */}
      <form onSubmit={onSubmit} noValidate>
        <div className="grid gap-4 xl:grid-cols-2">
          {/* ------------------------------------------------------ left: form */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Content</CardTitle>
                <CardDescription>
                  Click a variable below to drop it in wherever your cursor is.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <TemplateVariableChips
                  variables={variables ?? []}
                  onInsert={insertVariable}
                  disabled={!canEdit}
                />

                <FormField label="Subject" required error={errors.subject?.message}>
                  <Input
                    {...subjectReg}
                    ref={(el) => {
                      subjectReg.ref(el);
                      subjectRef.current = el;
                    }}
                    onFocus={() => {
                      activeField.current = "subject";
                    }}
                    disabled={!canEdit}
                    className="font-mono text-xs"
                  />
                </FormField>

                <FormField
                  label="Body (HTML)"
                  required
                  description="Basic HTML: <p>, <strong>, <a>, <table>. Email clients ignore most CSS."
                  error={errors.bodyHtml?.message}
                >
                  <Textarea
                    {...bodyReg}
                    ref={(el) => {
                      bodyReg.ref(el);
                      bodyRef.current = el;
                    }}
                    onFocus={() => {
                      activeField.current = "bodyHtml";
                    }}
                    disabled={!canEdit}
                    rows={12}
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                </FormField>

                <FormField
                  label="Signature"
                  description="Appears under the body. Leave blank to omit."
                  error={errors.signature?.message}
                >
                  <Textarea
                    {...signatureReg}
                    ref={(el) => {
                      signatureReg.ref(el);
                      signatureRef.current = el;
                    }}
                    onFocus={() => {
                      activeField.current = "signature";
                    }}
                    disabled={!canEdit}
                    rows={3}
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                </FormField>

                <FormField
                  label="Footer"
                  description="Leave blank to use your business name and contact details."
                  error={errors.footerHtml?.message}
                >
                  <Textarea
                    {...footerReg}
                    ref={(el) => {
                      footerReg.ref(el);
                      footerRef.current = el;
                    }}
                    onFocus={() => {
                      activeField.current = "footerHtml";
                    }}
                    disabled={!canEdit}
                    rows={3}
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                </FormField>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <FormField label="Primary colour" error={errors.primaryColor?.message}>
                  <Controller
                    control={control}
                    name="primaryColor"
                    render={({ field }) => (
                      <ColorField
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        disabled={!canEdit}
                        invalid={Boolean(errors.primaryColor)}
                      />
                    )}
                  />
                </FormField>

                <FormField label="Accent colour" error={errors.accentColor?.message}>
                  <Controller
                    control={control}
                    name="accentColor"
                    render={({ field }) => (
                      <ColorField
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        disabled={!canEdit}
                        invalid={Boolean(errors.accentColor)}
                      />
                    )}
                  />
                </FormField>

                <div className="border-border flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Show logo</p>
                    <p className="text-muted-foreground text-xs">
                      Falls back to your business name.
                    </p>
                  </div>
                  <Controller
                    control={control}
                    name="showLogo"
                    render={({ field }) => (
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!canEdit}
                        label="Show logo in this email"
                      />
                    )}
                  />
                </div>

                <div className="border-border flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Active</p>
                    <p className="text-muted-foreground text-xs">
                      Turn off to stop sending this email.
                    </p>
                  </div>
                  <Controller
                    control={control}
                    name="isActive"
                    render={({ field }) => (
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!canEdit}
                        label="This template is active"
                      />
                    )}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* --------------------------------------------------- right: preview */}
          <div className="xl:sticky xl:top-20 xl:self-start">
            <Card className="overflow-hidden">
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2">
                    <Eye className="size-4" aria-hidden="true" />
                    Preview
                  </CardTitle>
                  <CardDescription className="truncate">
                    Subject: {renderSubjectPreview(values.subject, samples) || "—"}
                  </CardDescription>
                </div>

                <Select
                  aria-label="Preview mode"
                  selectSize="sm"
                  className="w-auto min-w-36"
                  value={previewMode}
                  onChange={(event) => setPreviewMode(event.target.value as PreviewMode)}
                  options={[
                    { value: "live", label: "Live (unsaved)" },
                    { value: "saved", label: "Saved version" },
                  ]}
                />
              </CardHeader>

              <CardContent>
                {/*
                  An IFRAME, not a div with dangerouslySetInnerHTML.
                  The template is a full email document — `body { margin:0 !important }`,
                  600px tables, its own <style> block. Rendered inline it would
                  fight the app's stylesheet and win some of the fights. The iframe
                  is a document boundary, so it cannot.
                  sandbox="" removes scripts and same-origin access.
                */}
                <iframe
                  title={`Preview of the ${KIND_LABELS[kind]} email`}
                  srcDoc={previewHtml}
                  sandbox=""
                  className="border-border bg-white h-[36rem] w-full rounded-lg border"
                />
                <p className="text-muted-foreground mt-2 text-xs">
                  {previewMode === "live"
                    ? "Rendered from your unsaved edits, with sample data."
                    : "Rendered by the server from the saved template."}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ------------------------------------------------------------- save */}
        <div className="border-border bg-background/80 sticky bottom-0 mt-4 flex flex-col gap-3 border-t py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {!canEdit
              ? "You have read-only access to templates."
              : isDirty
                ? "You have unsaved changes."
                : "Everything is saved."}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!isDirty || isSubmitting}
              onClick={() => template && reset(toFormValues(template))}
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
              Save template
            </Button>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={isResetOpen}
        onOpenChange={setResetOpen}
        title="Reset this template?"
        description={`Your edits to the ${KIND_LABELS[kind]} email will be discarded and the original wording restored. This cannot be undone.`}
        confirmLabel="Reset to default"
        destructive
        isLoading={resetTemplate.isPending}
        onConfirm={onReset}
      />
    </div>
  );
}
