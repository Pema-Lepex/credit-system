/**
 * Bulk import client — templates out, spreadsheets in.
 *
 * REST, not GraphQL, for the same reason uploads are: the payload is a file. See
 * backend/app/api/imports.py. The auth/refresh dance is borrowed from
 * `@/features/settings/lib/http` rather than reimplemented — there must be exactly
 * one thing in the app that can refresh a token.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { API_URL } from "@/lib/graphql/client";
import {
  HttpError,
  authedFetch,
  downloadFile,
  messageFromResponse,
} from "@/features/settings/lib/http";
import { customerKeys } from "@/features/customers/queries";
import { creditKeys } from "@/features/credits/queries";

/** The two things a spreadsheet can become. Mirrors DATASETS in the import service. */
export type ImportDataset = "customers" | "credits";

export type TemplateFormat = "xlsx" | "csv";

/** One column of the sheet, as described by the backend's column spec. */
export interface ImportColumn {
  key: string;
  label: string;
  required: boolean;
  help: string;
  example: string;
  choices: string[];
}

export interface ImportFieldGuide {
  dataset: ImportDataset;
  title: string;
  intro: string;
  columns: ImportColumn[];
}

/** A problem with one row, addressed to the person holding the spreadsheet. */
export interface ImportIssue {
  /** The row number as Excel shows it: the header is row 1, so data starts at 2. */
  row: number;
  column: string | null;
  message: string;
}

export interface ImportReport {
  dataset: ImportDataset;
  dryRun: boolean;
  totalRows: number;
  created: number;
  ok: boolean;
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

export const importKeys = {
  all: ["imports"] as const,
  fields: (dataset: ImportDataset) => ["imports", "fields", dataset] as const,
};

// ---------------------------------------------------------------------------
// Field guide
// ---------------------------------------------------------------------------
/**
 * The column reference the UI renders.
 *
 * Fetched rather than hardcoded on purpose: the backend generates it from the same
 * spec its validator uses, so the help text on screen cannot drift from the rules
 * actually enforced. A duplicated list here would go stale the first time a column
 * is added.
 */
export function useImportFields(dataset: ImportDataset) {
  return useQuery({
    queryKey: importKeys.fields(dataset),
    queryFn: async (): Promise<ImportFieldGuide> => {
      const response = await authedFetch((token) =>
        fetch(`${API_URL}/api/imports/${dataset}/fields`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }),
      );
      if (!response.ok) {
        throw new HttpError(
          await messageFromResponse(response, "Could not load the field list."),
          response.status,
        );
      }
      return (await response.json()) as ImportFieldGuide;
    },
    // The columns change only when the app is redeployed.
    staleTime: 30 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Template download
// ---------------------------------------------------------------------------
export function downloadTemplate(
  dataset: ImportDataset,
  format: TemplateFormat,
): Promise<void> {
  return downloadFile(
    `/api/imports/${dataset}/template?format=${format}`,
    `${dataset}-import-template.${format}`,
  );
}

// ---------------------------------------------------------------------------
// Preview / commit
// ---------------------------------------------------------------------------
async function postSheet(
  dataset: ImportDataset,
  file: File,
  dryRun: boolean,
): Promise<ImportReport> {
  const body = new FormData();
  body.append("file", file);

  const response = await authedFetch((token) =>
    fetch(`${API_URL}/api/imports/${dataset}?dry_run=${dryRun}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body,
    }),
  );

  if (!response.ok) {
    // A rejected *file* (wrong headings, too big) 4xxs. A rejected *row* comes back
    // 200 with errors in the report — it is an answer, not a failure.
    throw new HttpError(
      await messageFromResponse(response, "That file could not be read."),
      response.status,
    );
  }
  return (await response.json()) as ImportReport;
}

/** Validate a sheet without writing anything. */
export function usePreviewImport(dataset: ImportDataset) {
  return useMutation({
    mutationFn: (file: File) => postSheet(dataset, file, true),
  });
}

/**
 * Import a sheet for real.
 *
 * Invalidates the whole domain afterwards rather than patching the cache: a single
 * upload can create hundreds of rows across several pages, and reconciling that by
 * hand is far more likely to be wrong than a refetch is to be slow.
 */
export function useCommitImport(dataset: ImportDataset) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => postSheet(dataset, file, false),
    onSuccess: (report) => {
      if (report.created === 0) return;
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
      if (dataset === "credits") {
        void queryClient.invalidateQueries({ queryKey: creditKeys.all });
      }
    },
  });
}
