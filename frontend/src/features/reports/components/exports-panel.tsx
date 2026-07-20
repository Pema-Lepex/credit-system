"use client";

import { differenceInMinutes } from "date-fns";
import { Download, Eye, FileDown, FileSpreadsheet, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  FormField,
  Pagination,
  Select,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@/components/ui";
import {
  EXPORT_DATASETS,
  useCreateExport,
  useDeleteExport,
  useExports,
  type ExportJob,
} from "@/features/reports/api";
import { downloadFile, viewFile } from "@/features/settings/lib/http";
import { useAuth } from "@/lib/auth/AuthProvider";
import { GraphQLRequestError } from "@/lib/graphql/client";
import { EXPORT_STATE_STYLES, cn, formatBytes, formatDate, formatNumber, toDate } from "@/lib/utils";
import { EXPORT_FORMATS, type ExportFormat, type ISODate } from "@/types";

export interface ExportsPanelProps {
  /** The report's current range — the export dialog defaults to it. */
  dateFrom: ISODate | null;
  dateTo: ISODate | null;
}

/**
 * Formats a browser will render in a tab. PDF opens in the built-in viewer and
 * JSON renders as text; CSV and XLSX are handed straight to the download manager
 * no matter what we do, so they get a Download button only.
 */
const VIEWABLE_FORMATS = new Set<ExportFormat>(["PDF", "JSON"]);

export function ExportsPanel({ dateFrom, dateTo }: ExportsPanelProps) {
  const [isDialogOpen, setDialogOpen] = useState(false);
  const { hasPermission } = useAuth();
  const canExport = hasPermission("export:create");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-foreground text-lg font-semibold">Exports</h2>
          <p className="text-muted-foreground text-sm">
            Download your data as CSV, Excel, JSON or PDF.
          </p>
        </div>
        <Button
          leftIcon={<FileDown />}
          disabled={!canExport}
          onClick={() => setDialogOpen(true)}
        >
          New export
        </Button>
      </div>

      <ExportsTable />

      <CreateExportDialog
        open={isDialogOpen}
        onOpenChange={setDialogOpen}
        defaultFrom={dateFrom}
        defaultTo={dateTo}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
interface CreateExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultFrom: ISODate | null;
  defaultTo: ISODate | null;
}

function CreateExportDialog({
  open,
  onOpenChange,
  defaultFrom,
  defaultTo,
}: CreateExportDialogProps) {
  const createExport = useCreateExport();

  const [format, setFormat] = useState<ExportFormat>("CSV");
  const [datasets, setDatasets] = useState<string[]>(["credits", "payments"]);
  const [from, setFrom] = useState<string>(defaultFrom ?? "");
  const [to, setTo] = useState<string>(defaultTo ?? "");

  const toggle = (value: string) => {
    setDatasets((current) =>
      current.includes(value) ? current.filter((d) => d !== value) : [...current, value],
    );
  };

  const submit = async () => {
    if (datasets.length === 0) {
      toast.error("Choose at least one dataset to export.");
      return;
    }
    try {
      const job = await createExport.mutateAsync({
        format,
        datasets,
        dateFrom: from === "" ? null : from,
        dateTo: to === "" ? null : to,
      });

      if (job.state === "FAILED") {
        toast.error("The export failed.", { description: job.error ?? undefined });
      } else {
        toast.success("Export ready.", {
          description: `${formatNumber(job.rowCount)} rows · ${formatBytes(job.sizeBytes)}. It expires in 24 hours.`,
        });
        onOpenChange(false);
      }
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError ? error.message : "Could not create the export.",
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New export"
      description="Pick what to include and how you want it. The file is generated immediately."
      size="lg"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createExport.isPending}
          >
            Cancel
          </Button>
          <Button isLoading={createExport.isPending} onClick={() => void submit()}>
            Generate export
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormField label="Format">
          <Select
            value={format}
            onChange={(event) => setFormat(event.target.value as ExportFormat)}
            options={EXPORT_FORMATS.map((f) => ({
              value: f,
              label:
                f === "CSV"
                  ? "CSV (one file per dataset)"
                  : f === "XLSX"
                    ? "Excel (XLSX)"
                    : f === "JSON"
                      ? "JSON"
                      : "PDF (printable report)",
            }))}
          />
        </FormField>

        <fieldset className="space-y-2">
          <legend className="text-foreground text-sm font-medium">Datasets</legend>
          <p className="text-muted-foreground text-xs">
            Choose one or more. With CSV, several datasets arrive as a ZIP.
          </p>
          <div className="grid gap-2 pt-1 sm:grid-cols-2">
            {EXPORT_DATASETS.map((dataset) => (
              <label
                key={dataset.value}
                className="border-border hover:bg-muted/50 flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm"
              >
                <Checkbox
                  checked={datasets.includes(dataset.value)}
                  onChange={() => toggle(dataset.value)}
                />
                {dataset.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="From" description="Leave blank for all time.">
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
          </FormField>
          <FormField label="To">
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
          </FormField>
        </div>

        <Alert variant="info">
          Exports are deleted permanently 24 hours after they are generated, to keep them off
          your storage quota. Download the file soon after it is ready — you can always generate
          another, or delete it yourself once you have saved a copy.
        </Alert>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
/**
 * How long is left before the file is gone — or, honestly, that it already is.
 * An EXPIRED export whose row still shows a Download button is a lie the user
 * only discovers when they click it.
 */
function expiryLabel(job: ExportJob): { text: string; expired: boolean } {
  if (job.state === "EXPIRED") return { text: "Expired", expired: true };
  const expiry = toDate(job.expiresAt);
  if (!expiry) return { text: "—", expired: false };

  const minutes = differenceInMinutes(expiry, new Date());
  if (minutes <= 0) return { text: "Expired", expired: true };
  if (minutes < 60) return { text: `${minutes} min left`, expired: false };

  const hours = Math.floor(minutes / 60);
  return { text: `${hours} hour${hours === 1 ? "" : "s"} left`, expired: false };
}

function ExportsTable() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useExports(page);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  // The job awaiting confirmation. Holding the job (not just an id) keeps the
  // dialog's copy specific — "delete the CSV of customers", not "delete this item".
  const [pendingDelete, setPendingDelete] = useState<ExportJob | null>(null);
  const remove = useDeleteExport();

  const jobs = data?.items ?? [];

  const download = async (job: ExportJob) => {
    setDownloading(job.id);
    try {
      await downloadFile(`/api/exports/${job.id}/download`, `export-${job.id}.${job.format.toLowerCase()}`);
      toast.success("Export downloaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download that export.");
    } finally {
      setDownloading(null);
    }
  };

  const view = async (job: ExportJob) => {
    setViewing(job.id);
    try {
      await viewFile(`/api/exports/${job.id}/download`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open that export.");
    } finally {
      setViewing(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await remove.mutateAsync(pendingDelete.id);
      toast.success("Export deleted.");
      setPendingDelete(null);
      // Deleting the last row of the last page would otherwise strand the user on
      // an empty page with no way back.
      if (jobs.length === 1 && page > 1) setPage((p) => p - 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete that export.");
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <SkeletonTable rows={3} columns={5} />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive" title="Could not load your exports">
        Please try again.
      </Alert>
    );
  }

  if (jobs.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState
            icon={<FileSpreadsheet />}
            size="sm"
            title="No exports yet"
            description="Generate one and it will appear here, with a countdown to its expiry."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Export</TableHead>
              <TableHead>State</TableHead>
              <TableHead align="right">Rows</TableHead>
              <TableHead align="right">Size</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead align="right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => {
              const style = EXPORT_STATE_STYLES[job.state];
              const expiry = expiryLabel(job);
              const downloadable = job.state === "READY" && !expiry.expired;
              // A browser can only render some of these in a tab. Offering "View"
              // on a spreadsheet means the button can ONLY ever download, which is
              // exactly the behaviour the button is supposed to avoid.
              const viewable = downloadable && VIEWABLE_FORMATS.has(job.format);

              return (
                <TableRow key={job.id}>
                  <TableCell>
                    <p className="text-sm font-medium">{job.format}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {job.datasets.join(", ")} · {formatDate(job.createdAt, "d MMM, HH:mm")}
                    </p>
                  </TableCell>

                  <TableCell>
                    <Badge className={cn(style.className)} dot>
                      {style.label}
                    </Badge>
                    {job.state === "FAILED" && job.error ? (
                      <p className="text-destructive-soft-foreground mt-1 max-w-xs text-xs">
                        {job.error}
                      </p>
                    ) : null}
                  </TableCell>

                  <TableCell numeric>{formatNumber(job.rowCount)}</TableCell>
                  <TableCell numeric>{formatBytes(job.sizeBytes)}</TableCell>

                  <TableCell>
                    <span
                      className={cn(
                        "text-sm",
                        expiry.expired
                          ? "text-muted-foreground"
                          : "text-foreground",
                      )}
                    >
                      {expiry.text}
                    </span>
                  </TableCell>

                  <TableCell align="right">
                    <div className="flex items-center justify-end gap-2">
                      {downloadable ? (
                        <>
                          {viewable ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              leftIcon={<Eye />}
                              isLoading={viewing === job.id}
                              onClick={() => void view(job)}
                            >
                              View
                            </Button>
                          ) : null}
                          <Button
                            variant="outline"
                            size="sm"
                            leftIcon={<Download />}
                            isLoading={downloading === job.id}
                            onClick={() => void download(job)}
                          >
                            Download
                          </Button>
                        </>
                      ) : (
                        // No dead button. If the file is gone, say so.
                        <span className="text-muted-foreground text-xs">
                          {expiry.expired ? "No longer available" : "—"}
                        </span>
                      )}

                      {/* Delete stays on EVERY row, whatever the state. A failed or
                          already-expired export is exactly the row a user most wants
                          out of their list, and it is the one a download-gated button
                          would have hidden. */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        // Red only on hover: a permanent row of red trash icons reads
                        // as an error state, and makes the table feel dangerous.
                        className="hover:text-destructive"
                        aria-label={`Delete ${job.format} export`}
                        leftIcon={<Trash2 />}
                        isLoading={remove.isPending && pendingDelete?.id === job.id}
                        onClick={() => setPendingDelete(job)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Pagination
        page={page}
        pageSize={10}
        totalItems={data?.pageInfo.total ?? 0}
        onPageChange={setPage}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this export?"
        description={
          pendingDelete
            ? `The ${pendingDelete.format} file (${pendingDelete.datasets.join(", ")}) will be ` +
              "deleted permanently, along with its record. This cannot be undone — but you " +
              "can always generate the export again."
            : undefined
        }
        confirmLabel="Delete"
        destructive
        isLoading={remove.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
