"use client";

import { FileSpreadsheet, FileText, Table2 } from "lucide-react";
import { useState } from "react";

import { Button, toast } from "@/components/ui";
import { useCreateExport } from "@/features/reports/api";
import { downloadFile } from "@/features/settings/lib/http";
import { GraphQLRequestError } from "@/lib/graphql/client";
import type { ExportFormat, ISODate } from "@/types";

/**
 * PDF / Excel / CSV download buttons for a report.
 *
 * HOW A DOWNLOAD ACTUALLY WORKS HERE — the same two steps as the Reports page's
 * existing PDF button, factored out so all four report surfaces share one
 * implementation:
 *
 *   1. `createExport` builds the file SERVER-side and returns the job already
 *      generated (state READY or FAILED). Nothing is rendered in the browser, so
 *      the CSV and the PDF are guaranteed to contain the same numbers as the
 *      screen — they come from the same service.
 *   2. An authenticated binary fetch to `/api/exports/{id}/download`, because a
 *      plain `<a href>` cannot carry the bearer token.
 *
 * The file expires server-side after 24h (spec: exports must not accumulate).
 */
export interface ReportDownloadButtonsProps {
  /** Backend dataset names — see app/services/export.py DATASETS. */
  datasets: string[];
  dateFrom: ISODate | null;
  dateTo: ISODate | null;
  /** Basename for the saved file, without extension. */
  filename: string;
  /** Omit a format to hide its button. Defaults to all three. */
  formats?: ExportFormat[];
  disabled?: boolean;
}

const FORMAT_META: Record<
  string,
  { label: string; extension: string; icon: React.ReactNode }
> = {
  PDF: { label: "PDF", extension: "pdf", icon: <FileText /> },
  XLSX: { label: "Excel", extension: "xlsx", icon: <FileSpreadsheet /> },
  CSV: { label: "CSV", extension: "csv", icon: <Table2 /> },
};

export function ReportDownloadButtons({
  datasets,
  dateFrom,
  dateTo,
  filename,
  formats = ["PDF", "XLSX", "CSV"],
  disabled = false,
}: ReportDownloadButtonsProps) {
  const createExport = useCreateExport();
  // Tracked per format, not as one boolean: clicking PDF must not put a spinner
  // on the Excel button too.
  const [working, setWorking] = useState<ExportFormat | null>(null);

  const download = async (format: ExportFormat) => {
    setWorking(format);
    try {
      const job = await createExport.mutateAsync({ format, datasets, dateFrom, dateTo });

      if (job.state !== "READY") {
        toast.error(`The ${FORMAT_META[format].label} could not be generated.`, {
          description: job.error ?? undefined,
        });
        return;
      }

      await downloadFile(
        `/api/exports/${job.id}/download`,
        `${filename}.${FORMAT_META[format].extension}`,
      );
      toast.success(`${FORMAT_META[format].label} downloaded.`);
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Could not download the report.",
      );
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {formats.map((format) => (
        <Button
          key={format}
          variant="outline"
          size="sm"
          leftIcon={FORMAT_META[format].icon}
          disabled={disabled || (working !== null && working !== format)}
          isLoading={working === format}
          loadingText="Preparing…"
          onClick={() => void download(format)}
        >
          {FORMAT_META[format].label}
        </Button>
      ))}
    </div>
  );
}
