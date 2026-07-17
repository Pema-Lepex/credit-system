"use client";

/**
 * The bulk-import screen: get a template, fill it in, check it, import it.
 *
 * WHY THE PREVIEW IS NOT OPTIONAL
 * -------------------------------
 * There is no "just import it" button. Every upload is validated first and the
 * report is shown, and only then does Import light up. That is one extra click on
 * a clean file and it is worth it: the alternative is an owner discovering 300
 * wrong rows *after* they are in the database, where the only fix is deleting them
 * one at a time.
 *
 * The backend enforces this too (dry_run defaults to true) -- this component is the
 * ergonomics, not the guarantee.
 */

import { CheckCircle2, FileDown, FileSpreadsheet, Info, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
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
  downloadTemplate,
  useCommitImport,
  useImportFields,
  usePreviewImport,
  type ImportDataset,
  type ImportIssue,
  type ImportReport,
} from "@/features/imports/api";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn, formatNumber } from "@/lib/utils";
import type { Permission } from "@/types";

const ACCEPTED = ".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Matches MAX_IMPORT_BYTES in the import service. Checked here only to fail fast. */
const MAX_BYTES = 5 * 1024 * 1024;

interface ImportViewProps {
  dataset: ImportDataset;
}

const COPY: Record<ImportDataset, { title: string; backHref: string; backLabel: string }> = {
  customers: { title: "Import customers", backHref: "/customers", backLabel: "Customers" },
  credits: { title: "Import credits", backHref: "/credits", backLabel: "Credits" },
  products: { title: "Import products", backHref: "/products", backLabel: "Products" },
  services: { title: "Import services", backHref: "/services", backLabel: "Services" },
};

export function ImportView({ dataset }: ImportViewProps) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { hasPermission } = useAuth();
  const canImport = hasPermission(PERMISSION[dataset]);

  const fields = useImportFields(dataset);
  const preview = usePreviewImport(dataset);
  const commit = useCommitImport(dataset);
  const copy = COPY[dataset];

  const busy = preview.isPending || commit.isPending;
  // Only a clean preview of THIS file may be imported. Any change to the selection
  // clears the report, so the button can never act on a stale verdict.
  const importable = report !== null && report.dryRun && report.ok && report.totalRows > 0;

  function reset() {
    setFile(null);
    setReport(null);
    preview.reset();
    commit.reset();
    if (inputRef.current) inputRef.current.value = "";
  }

  function choose(next: File | null) {
    setReport(null);
    commit.reset();
    preview.reset();
    setFile(next);
    if (!next) return;

    if (next.size > MAX_BYTES) {
      toast.error(
        `That file is ${(next.size / 1_048_576).toFixed(1)} MB. The limit is 5 MB — split it into smaller sheets.`,
      );
      setFile(null);
      return;
    }
    preview.mutate(next, {
      onSuccess: setReport,
      onError: (error) => toast.error(error.message),
    });
  }

  function runImport() {
    if (!file || !importable) return;
    commit.mutate(file, {
      onSuccess: (result) => {
        setReport(result);
        if (result.ok) {
          toast.success(
            `Imported ${formatNumber(result.created)} ${result.created === 1 ? rowNoun(dataset) : rowNoun(dataset, true)}.`,
          );
        } else {
          // The sheet passed the preview and failed the real thing — something
          // moved underneath us. The report says what.
          toast.error("The import was stopped and nothing was saved. See the errors below.");
        }
      },
      onError: (error) => toast.error(error.message),
    });
  }

  const done = commit.isSuccess && report !== null && !report.dryRun && report.ok;

  return (
    <div className="space-y-6">
      {done ? (
        <SuccessPanel report={report} dataset={dataset} onReset={reset} />
      ) : (
        <>
          <StepOne dataset={dataset} disabled={!canImport} />
          <StepTwo
            file={file}
            busy={busy}
            disabled={!canImport}
            inputRef={inputRef}
            onChoose={choose}
            onClear={reset}
          />
          {report !== null && (
            <StepThree
              report={report}
              importable={importable}
              busy={commit.isPending}
              onImport={runImport}
            />
          )}
        </>
      )}

      <FieldGuide
        columns={fields.data?.columns ?? []}
        intro={fields.data?.intro ?? ""}
        loading={fields.isLoading}
      />

      <p className="text-muted-foreground text-sm">
        Back to{" "}
        <Link href={copy.backHref} className="text-foreground underline underline-offset-4">
          {copy.backLabel}
        </Link>
      </p>
    </div>
  );
}

/** The permission each dataset writes with — mirrors DatasetSpec.permission. */
const PERMISSION: Record<ImportDataset, Permission> = {
  customers: "customer:write",
  credits: "credit:write",
  products: "catalog:write",
  services: "catalog:write",
};

const NOUN: Record<ImportDataset, [singular: string, plural: string]> = {
  customers: ["customer", "customers"],
  credits: ["credit record", "credit records"],
  products: ["product", "products"],
  services: ["service", "services"],
};

function rowNoun(dataset: ImportDataset, plural = false): string {
  return NOUN[dataset][plural ? 1 : 0];
}

// ---------------------------------------------------------------------------
// Step 1 — the template
// ---------------------------------------------------------------------------
function StepOne({ dataset, disabled }: { dataset: ImportDataset; disabled: boolean }) {
  const [pending, setPending] = useState<"xlsx" | "csv" | null>(null);

  async function get(format: "xlsx" | "csv") {
    setPending(format);
    try {
      await downloadTemplate(dataset, format);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download the template.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Step number={1} title="Download the template" >
      <p className="text-muted-foreground text-sm">
        The template has the right headings already in it, with notes on every column
        and an Instructions sheet. Fill in one row per{" "}
        {dataset === "customers" ? "customer" : "credit"}, starting under the headings.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          variant="secondary"
          leftIcon={<FileSpreadsheet />}
          disabled={disabled}
          isLoading={pending === "xlsx"}
          onClick={() => void get("xlsx")}
        >
          Excel template
        </Button>
        <Button
          variant="ghost"
          leftIcon={<FileDown />}
          disabled={disabled}
          isLoading={pending === "csv"}
          onClick={() => void get("csv")}
        >
          CSV template
        </Button>
      </div>
    </Step>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — the file
// ---------------------------------------------------------------------------
interface StepTwoProps {
  file: File | null;
  busy: boolean;
  disabled: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChoose: (file: File | null) => void;
  onClear: () => void;
}

function StepTwo({ file, busy, disabled, inputRef, onChoose, onClear }: StepTwoProps) {
  const [dragging, setDragging] = useState(false);

  return (
    <Step number={2} title="Upload your filled-in sheet">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => onChoose(event.target.files?.[0] ?? null)}
      />

      {file ? (
        <div className="border-border bg-muted/40 flex items-center gap-3 rounded-lg border p-4">
          <FileSpreadsheet className="text-muted-foreground size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-foreground truncate text-sm font-medium">{file.name}</p>
            <p className="text-muted-foreground text-xs">
              {(file.size / 1024).toFixed(0)} KB
              {busy ? " — checking…" : ""}
            </p>
          </div>
          <Button variant="ghost" size="sm" leftIcon={<X />} onClick={onClear} disabled={busy}>
            Remove
          </Button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            onChoose(event.dataTransfer.files?.[0] ?? null);
          }}
          className={cn(
            "border-border hover:border-foreground/30 hover:bg-muted/40 flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-8 transition-colors",
            dragging && "border-foreground/40 bg-muted/60",
            disabled && "pointer-events-none opacity-50",
          )}
        >
          <Upload className="text-muted-foreground size-6" />
          <span className="text-foreground text-sm font-medium">
            Drop your file here, or click to choose
          </span>
          <span className="text-muted-foreground text-xs">Excel (.xlsx) or CSV, up to 5 MB</span>
        </button>
      )}

      {disabled && (
        <Alert variant="warning" className="mt-4">
          You do not have permission to import. Ask an administrator.
        </Alert>
      )}
    </Step>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — the verdict
// ---------------------------------------------------------------------------
interface StepThreeProps {
  report: ImportReport;
  importable: boolean;
  busy: boolean;
  onImport: () => void;
}

function StepThree({ report, importable, busy, onImport }: StepThreeProps) {
  const { errors, warnings, totalRows } = report;

  return (
    <Step number={3} title="Check and import">
      {errors.length > 0 ? (
        <Alert variant="destructive" className="mb-4">
          <span className="font-medium">
            Nothing has been imported. {formatNumber(errors.length)}{" "}
            {errors.length === 1 ? "problem needs" : "problems need"} fixing first.
          </span>{" "}
          Correct these rows in your sheet, save it, and upload it again. An import is
          all-or-nothing, so no partly-finished data is left behind.
        </Alert>
      ) : (
        <Alert variant="success" className="mb-4">
          <span className="font-medium">
            {formatNumber(totalRows)} {totalRows === 1 ? "row is" : "rows are"} ready to
            import.
          </span>{" "}
          Nothing has been saved yet — press Import to write them.
        </Alert>
      )}

      {warnings.length > 0 && (
        <div className="mb-4">
          <IssueTable
            issues={warnings}
            tone="warning"
            caption="Worth a look — these will not stop the import."
          />
        </div>
      )}

      {errors.length > 0 && <IssueTable issues={errors} tone="destructive" caption="Fix these rows." />}

      <div className="mt-4 flex items-center gap-3">
        <Button
          leftIcon={<Upload />}
          disabled={!importable}
          isLoading={busy}
          onClick={onImport}
        >
          Import {formatNumber(totalRows)} {totalRows === 1 ? "row" : "rows"}
        </Button>
        {!importable && errors.length > 0 && (
          <span className="text-muted-foreground text-sm">Fix the errors above first.</span>
        )}
      </div>
    </Step>
  );
}

function IssueTable({
  issues,
  tone,
  caption,
}: {
  issues: ImportIssue[];
  tone: "destructive" | "warning";
  caption: string;
}) {
  // A sheet with 300 broken rows produces 300 messages; rendering them all turns
  // the page into a wall nobody reads. The first 50 are enough to go and fix the
  // pattern, and the count tells them how much is left.
  const shown = issues.slice(0, 50);
  const hidden = issues.length - shown.length;

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">{caption}</p>
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Row</TableHead>
              <TableHead className="w-48">Column</TableHead>
              <TableHead>What to do</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((issue, index) => (
              <TableRow key={`${issue.row}-${issue.column ?? ""}-${index}`}>
                <TableCell>
                  <Badge variant={tone === "destructive" ? "destructive" : "warning"}>
                    {issue.row > 0 ? issue.row : "—"}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{issue.column ?? "—"}</TableCell>
                <TableCell className="text-sm">{issue.message}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {hidden > 0 && (
        <p className="text-muted-foreground text-sm">
          …and {formatNumber(hidden)} more. Fix these first — the same mistake is often
          repeated down the sheet.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------
function SuccessPanel({
  report,
  dataset,
  onReset,
}: {
  report: ImportReport;
  dataset: ImportDataset;
  onReset: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        <span className="bg-success/10 text-success flex size-12 items-center justify-center rounded-full">
          <CheckCircle2 className="size-6" />
        </span>
        <div>
          <h2 className="text-foreground text-lg font-semibold">
            Imported {formatNumber(report.created)}{" "}
            {report.created === 1 ? rowNoun(dataset) : rowNoun(dataset, true)}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            They are in your {rowNoun(dataset, true)} now.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href={COPY[dataset].backHref}>
            <Button>View {rowNoun(dataset, true)}</Button>
          </Link>
          <Button variant="secondary" onClick={onReset}>
            Import another sheet
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The field guide
// ---------------------------------------------------------------------------
function FieldGuide({
  columns,
  intro,
  loading,
}: {
  columns: { key: string; required: boolean; help: string; example: string }[];
  intro: string;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="hover:bg-muted/40 flex w-full items-center gap-3 p-5 text-left transition-colors"
          aria-expanded={open}
        >
          <Info className="text-muted-foreground size-5 shrink-0" />
          <span className="flex-1">
            <span className="text-foreground block text-sm font-medium">
              What goes in each column
            </span>
            <span className="text-muted-foreground block text-sm">
              {intro || "Every column the sheet accepts, and what it expects."}
            </span>
          </span>
          <span className="text-muted-foreground text-sm">{open ? "Hide" : "Show"}</span>
        </button>

        {open && !loading && (
          <div className="border-border border-t">
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-56">Column</TableHead>
                    <TableHead>What to put in it</TableHead>
                    <TableHead className="w-44">Example</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {columns.map((column) => (
                    <TableRow key={column.key}>
                      <TableCell>
                        <span className="font-mono text-xs">{column.key}</span>
                        {column.required && (
                          <Badge variant="destructive" className="ml-2">
                            Required
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{column.help || "—"}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {column.example || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-3">
          <span className="bg-muted text-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
            {number}
          </span>
          <h2 className="text-foreground text-base font-semibold">{title}</h2>
        </div>
        <div className="sm:pl-10">{children}</div>
      </CardContent>
    </Card>
  );
}
