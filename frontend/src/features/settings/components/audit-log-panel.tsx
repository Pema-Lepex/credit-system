"use client";

/**
 * The audit report: a filterable, paginated view of every recorded action —
 * created, updated, deleted, restored, purged, plus logins and system jobs —
 * with the field-level before/after diff expandable per row.
 *
 * Read-only. The trail is append-only on the server; nothing here can change it.
 */

import { ChevronDown, ChevronRight, ScrollText } from "lucide-react";
import { useState } from "react";

import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  Input,
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
} from "@/components/ui";
import {
  useAuditLogs,
  type AuditChanges,
  type AuditLogFilters,
  type AuditLogRow,
} from "@/features/settings/api/audit";
import { formatDateTime } from "@/lib/utils";
import { AUDIT_ACTIONS, type AuditAction } from "@/types";

const ACTION_TONE: Record<AuditAction, "neutral" | "success" | "warning" | "destructive" | "info"> = {
  CREATE: "success",
  UPDATE: "info",
  DELETE: "warning",
  PURGE: "destructive",
  RESTORE: "success",
  LOGIN: "neutral",
  LOGIN_FAILED: "destructive",
  LOGOUT: "neutral",
  PASSWORD_RESET: "warning",
  EXPORT: "neutral",
  ARCHIVE: "neutral",
  MAINTENANCE: "neutral",
  REMINDER: "info",
};

const ACTION_LABEL: Record<AuditAction, string> = {
  CREATE: "Created",
  UPDATE: "Updated",
  DELETE: "Deleted",
  PURGE: "Purged",
  RESTORE: "Restored",
  LOGIN: "Signed in",
  LOGIN_FAILED: "Sign-in failed",
  LOGOUT: "Signed out",
  PASSWORD_RESET: "Password reset",
  EXPORT: "Exported",
  ARCHIVE: "Archived",
  MAINTENANCE: "Maintenance",
  REMINDER: "Reminder",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** The {field: [before, after]} diff, rendered as a readable before → after list. */
function ChangeDiff({ changes }: { changes: AuditChanges }) {
  const entries = Object.entries(changes);
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">No field changes were recorded.</p>;
  }
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-[minmax(8rem,12rem)_1fr]">
      {entries.map(([field, [before, after]]) => (
        <div key={field} className="contents">
          <dt className="text-muted-foreground font-medium break-words">{field}</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground line-through decoration-1">
              {formatValue(before)}
            </span>
            <ChevronRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
            <span className="text-foreground font-medium">{formatValue(after)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AuditRow({ log }: { log: AuditLogRow }) {
  const [open, setOpen] = useState(false);
  const hasChanges = Object.keys(log.changes ?? {}).length > 0;

  return (
    <>
      <TableRow>
        <TableCell className="align-top whitespace-nowrap tabular">
          {formatDateTime(log.createdAt)}
        </TableCell>
        <TableCell className="align-top">{log.actorLabel}</TableCell>
        <TableCell className="align-top">
          <Badge size="sm" variant={ACTION_TONE[log.action]}>
            {ACTION_LABEL[log.action] ?? log.action}
          </Badge>
        </TableCell>
        <TableCell className="align-top capitalize">{log.entityType}</TableCell>
        <TableCell className="align-top">
          <div className="space-y-1">
            <p className="text-foreground">{log.summary}</p>
            {hasChanges ? (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="text-primary focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm text-xs font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                {open ? (
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                )}
                {open ? "Hide changes" : `Show ${Object.keys(log.changes).length} field change${Object.keys(log.changes).length === 1 ? "" : "s"}`}
              </button>
            ) : null}
          </div>
        </TableCell>
      </TableRow>
      {open && hasChanges ? (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/40">
            <ChangeDiff changes={log.changes} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

// The entity types the app actually writes audit rows for — surfaced as a filter.
const ENTITY_TYPES = [
  "credit",
  "payment",
  "customer",
  "product",
  "service",
  "category",
  "business",
  "user",
  "export_job",
  "archive_batch",
] as const;

export function AuditLogPanel() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<AuditLogFilters>({});
  const { data, isLoading } = useAuditLogs(page, filters);

  const patch = (next: Partial<AuditLogFilters>) => {
    setFilters((f) => ({ ...f, ...next }));
    setPage(1);
  };

  const items = data?.items ?? [];

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="sm:w-44">
            <label className="text-muted-foreground mb-1 block text-xs font-medium">Action</label>
            <Select
              selectSize="sm"
              value={filters.action ?? ""}
              onChange={(e) => patch({ action: (e.target.value || null) as AuditAction | null })}
              options={[
                { value: "", label: "All actions" },
                ...AUDIT_ACTIONS.map((a) => ({ value: a, label: ACTION_LABEL[a] ?? a })),
              ]}
            />
          </div>
          <div className="sm:w-44">
            <label className="text-muted-foreground mb-1 block text-xs font-medium">Record type</label>
            <Select
              selectSize="sm"
              value={filters.entityType ?? ""}
              onChange={(e) => patch({ entityType: e.target.value || null })}
              options={[
                { value: "", label: "All records" },
                ...ENTITY_TYPES.map((t) => ({ value: t, label: t.replace("_", " ") })),
              ]}
            />
          </div>
          <div className="flex-1 sm:min-w-48">
            <label className="text-muted-foreground mb-1 block text-xs font-medium">Search</label>
            <Input
              inputSize="sm"
              placeholder="Search the description…"
              value={filters.search ?? ""}
              onChange={(e) => patch({ search: e.target.value || null })}
            />
          </div>
        </div>

        {isLoading ? (
          <SkeletonTable rows={6} columns={5} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ScrollText />}
            title="Nothing to show"
            description="No activity matches these filters yet. Actions people take across the app appear here."
          />
        ) : (
          <>
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Record</TableHead>
                    <TableHead>What happened</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((log) => (
                    <AuditRow key={log.id} log={log} />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Pagination
              page={page}
              pageSize={20}
              totalItems={data?.pageInfo.total ?? 0}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
