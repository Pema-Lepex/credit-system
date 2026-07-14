"use client";

/**
 * Email templates: `emailTemplates`, `emailTemplate(kind)`, `templateVariables(kind)`,
 * `updateEmailTemplate`, `resetEmailTemplate`, `previewEmailTemplate`.
 *
 * `previewEmailTemplate` renders the SAVED template server-side. The editor's
 * live pane therefore cannot use it — it renders the *unsaved* form values
 * locally (see lib/render-preview.ts). Both are offered; the UI labels which is
 * which, because silently showing someone yesterday's template while they type is
 * how you ship a broken email.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { gqlRequest } from "@/lib/graphql/client";
import type { EmailTemplateKind, ID, ISODateTime } from "@/types";

export interface EmailTemplateSummary {
  id: ID;
  kind: EmailTemplateKind;
  name: string;
  subject: string;
  bodyHtml: string;
  footerHtml: string | null;
  signature: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  showLogo: boolean;
  isActive: boolean;
  /** False once the owner has edited the shipped copy. Drives the Default/Edited badge. */
  isDefault: boolean;
  updatedAt: ISODateTime;
}

export interface EmailTemplateInput {
  subject?: string;
  bodyHtml?: string;
  footerHtml?: string | null;
  signature?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  showLogo?: boolean;
  isActive?: boolean;
}

export interface TemplateVariable {
  name: string;
  description: string;
  example: string;
}

const TEMPLATE_FIELDS = /* GraphQL */ `
  fragment EmailTemplateFields on EmailTemplateType {
    id
    kind
    name
    subject
    bodyHtml
    footerHtml
    signature
    primaryColor
    accentColor
    showLogo
    isActive
    isDefault
    updatedAt
  }
`;

const TEMPLATES_QUERY = /* GraphQL */ `
  ${TEMPLATE_FIELDS}
  query EmailTemplates {
    emailTemplates {
      ...EmailTemplateFields
    }
  }
`;

const TEMPLATE_VARIABLES_QUERY = /* GraphQL */ `
  query TemplateVariables($kind: EmailTemplateKind!) {
    templateVariables(kind: $kind) {
      name
      description
      example
    }
  }
`;

const PREVIEW_TEMPLATE_QUERY = /* GraphQL */ `
  mutation PreviewEmailTemplate($kind: EmailTemplateKind!) {
    previewEmailTemplate(kind: $kind)
  }
`;

const UPDATE_TEMPLATE_MUTATION = /* GraphQL */ `
  ${TEMPLATE_FIELDS}
  mutation UpdateEmailTemplate($kind: EmailTemplateKind!, $input: EmailTemplateInput!) {
    updateEmailTemplate(kind: $kind, input: $input) {
      ...EmailTemplateFields
    }
  }
`;

const RESET_TEMPLATE_MUTATION = /* GraphQL */ `
  ${TEMPLATE_FIELDS}
  mutation ResetEmailTemplate($kind: EmailTemplateKind!) {
    resetEmailTemplate(kind: $kind) {
      ...EmailTemplateFields
    }
  }
`;

export const templateKeys = {
  all: ["email-templates"] as const,
  list: () => ["email-templates", "list"] as const,
  variables: (kind: EmailTemplateKind) => ["email-templates", "variables", kind] as const,
  preview: (kind: EmailTemplateKind) => ["email-templates", "preview", kind] as const,
};

export function useEmailTemplates(): UseQueryResult<EmailTemplateSummary[]> {
  return useQuery({
    queryKey: templateKeys.list(),
    queryFn: async () => {
      const data = await gqlRequest<{ emailTemplates: EmailTemplateSummary[] }>(TEMPLATES_QUERY);
      return data.emailTemplates;
    },
  });
}

export function useTemplateVariables(kind: EmailTemplateKind): UseQueryResult<TemplateVariable[]> {
  return useQuery({
    queryKey: templateKeys.variables(kind),
    queryFn: async () => {
      const data = await gqlRequest<
        { templateVariables: TemplateVariable[] },
        { kind: EmailTemplateKind }
      >(TEMPLATE_VARIABLES_QUERY, { kind });
      return data.templateVariables;
    },
    // The variable set for a kind is fixed by the backend — it never changes.
    staleTime: Infinity,
  });
}

/** The SAVED template, rendered server-side with realistic sample data. */
export function useServerPreview(kind: EmailTemplateKind, enabled: boolean) {
  return useQuery({
    queryKey: templateKeys.preview(kind),
    queryFn: async () => {
      const data = await gqlRequest<
        { previewEmailTemplate: string },
        { kind: EmailTemplateKind }
      >(PREVIEW_TEMPLATE_QUERY, { kind });
      return data.previewEmailTemplate;
    },
    enabled,
    staleTime: 0,
  });
}

export function useUpdateEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      kind,
      input,
    }: {
      kind: EmailTemplateKind;
      input: EmailTemplateInput;
    }) => {
      const data = await gqlRequest<
        { updateEmailTemplate: EmailTemplateSummary },
        { kind: EmailTemplateKind; input: EmailTemplateInput }
      >(UPDATE_TEMPLATE_MUTATION, { kind, input });
      return data.updateEmailTemplate;
    },
    onSuccess: (template) => {
      void queryClient.invalidateQueries({ queryKey: templateKeys.list() });
      void queryClient.invalidateQueries({ queryKey: templateKeys.preview(template.kind) });
    },
  });
}

export function useResetEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (kind: EmailTemplateKind) => {
      const data = await gqlRequest<
        { resetEmailTemplate: EmailTemplateSummary },
        { kind: EmailTemplateKind }
      >(RESET_TEMPLATE_MUTATION, { kind });
      return data.resetEmailTemplate;
    },
    onSuccess: (template) => {
      void queryClient.invalidateQueries({ queryKey: templateKeys.list() });
      void queryClient.invalidateQueries({ queryKey: templateKeys.preview(template.kind) });
    },
  });
}
