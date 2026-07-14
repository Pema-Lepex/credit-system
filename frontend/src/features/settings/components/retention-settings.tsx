"use client";

import {
  Archive,
  CalendarClock,
  Download,
  Info,
  RotateCcw,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  Pagination,
  Select,
  Skeleton,
  SkeletonTable,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@/components/ui";
import { useBusiness, useUpdateBusiness } from "@/features/settings/api/business";
import {
  ARCHIVE_STATE_LABELS,
  RETENTION_POLICY_LABELS,
  useArchiveBatches,
  usePostponeDeletion,
  useRestoreArchive,
  useRetentionPreview,
  type ArchiveBatch,
} from "@/features/settings/api/retention";
import { downloadFile } from "@/features/settings/lib/http";
import { useAuth } from "@/lib/auth/AuthProvider";
import { GraphQLRequestError } from "@/lib/graphql/client";
import { cn, formatBytes, formatDate, formatNumber } from "@/lib/utils";
import { RETENTION_POLICIES, type ArchiveState, type RetentionPolicy } from "@/types";

const POLICY_BLURBS: Record<RetentionPolicy, string> = {
  DAYS_30: "Closed credits are archived 30 days after they are settled.",
  DAYS_60: "Closed credits are archived 60 days after they are settled.",
  DAYS_90: "Closed credits are archived 90 days after they are settled.",
  NEVER: "Nothing is ever archived or deleted. Your storage will keep growing.",
};

export function RetentionSettings() {
  const { data: business, isLoading } = useBusiness();
  const updateBusiness = useUpdateBusiness();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("retention:manage") || hasPermission("business:update");

  const { data: preview, isLoading: previewLoading } = useRetentionPreview();

  const [policy, setPolicy] = useState<RetentionPolicy>("NEVER");
  const [notify, setNotify] = useState(true);
  const [isConfirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!business) return;
    setPolicy(business.retentionPolicy);
    setNotify(business.retentionNotificationsEnabled);
  }, [business]);

  const savedPolicy = business?.retentionPolicy;
  const policyChanged = savedPolicy !== undefined && policy !== savedPolicy;
  const notifyChanged =
    business !== undefined && notify !== business.retentionNotificationsEnabled;
  const isDirty = policyChanged || notifyChanged;

  const save = async () => {
    try {
      await updateBusiness.mutateAsync({
        retentionPolicy: policy,
        retentionNotificationsEnabled: notify,
      });
      setConfirmOpen(false);
      toast.success("Retention policy updated.", {
        description:
          policy === "NEVER"
            ? "Nothing will be archived."
            : "Nothing is deleted without warning you first.",
      });
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError ? error.message : "Could not save the policy.",
      );
    }
  };

  if (isLoading || !business) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <div className="space-y-6">
      {/* The reassurance, stated once, at the top. */}
      <Alert variant="info" icon={<ShieldCheck className="size-4" />} title="Nothing disappears without warning">
        Archived records are kept for a further 90 days before deletion, and you are emailed
        before it happens. Right up to the last day you can download them, postpone, or restore
        them with one click.
      </Alert>

      {/* ----------------------------------------------------------- the policy */}
      <Card>
        <CardHeader>
          <CardTitle>Retention policy</CardTitle>
          <CardDescription>
            How long a <strong>settled</strong> credit stays in your active lists. Open credits —
            anything still owing — are never archived, whatever you choose here.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <fieldset disabled={!canEdit}>
            <legend className="sr-only">Choose a retention policy</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {RETENTION_POLICIES.map((option) => {
                const active = policy === option;
                return (
                  <label
                    key={option}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                      "focus-within:ring-ring focus-within:ring-2 focus-within:ring-offset-1",
                      active
                        ? "border-primary bg-primary-soft/40"
                        : "border-border hover:bg-muted/50",
                      !canEdit && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <input
                      type="radio"
                      name="retention-policy"
                      value={option}
                      checked={active}
                      onChange={() => setPolicy(option)}
                      className="text-primary focus:ring-ring mt-0.5 size-4"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {RETENTION_POLICY_LABELS[option]}
                        {savedPolicy === option ? (
                          <Badge variant="neutral" size="sm">
                            Current
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
                        {POLICY_BLURBS[option]}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* ---------------------------------------------------------- preview */}
          {previewLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : preview ? (
            <Alert variant="neutral" icon={<Info className="size-4" />}>
              {preview.records === 0 ? (
                <>
                  Under your current policy (
                  <strong>{RETENTION_POLICY_LABELS[preview.policy]}</strong>), the next sweep
                  would archive <strong>nothing</strong>.
                </>
              ) : (
                <>
                  Under your current policy (
                  <strong>{RETENTION_POLICY_LABELS[preview.policy]}</strong>), the next sweep
                  would archive <strong>{formatNumber(preview.records)} records</strong> —{" "}
                  {formatNumber(preview.credits)} settled credits and{" "}
                  {formatNumber(preview.payments)} payments. They would be exported first, and you
                  would have 90 days to change your mind.
                </>
              )}

              {/*
                HONESTY: `retentionPreview` takes no policy argument — the server
                computes it for the SAVED policy. We will not invent a number for a
                policy that has not been saved, so we say what we actually know.
              */}
              {policyChanged ? (
                <p className="mt-2">
                  You have selected <strong>{RETENTION_POLICY_LABELS[policy]}</strong>. The exact
                  count for that policy is calculated by the server once you save — a shorter
                  window archives more, a longer one archives less. Saving does not delete
                  anything: the sweep only ever archives, and archives are recoverable.
                </p>
              ) : null}
            </Alert>
          ) : null}

          <div className="border-border flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Email me before anything is deleted</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Warnings go out 30, 7 and 1 day before a batch is due for deletion. Strongly
                recommended.
              </p>
            </div>
            <Switch
              checked={notify}
              onCheckedChange={setNotify}
              disabled={!canEdit}
              label="Email me before anything is deleted"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <p aria-live="polite" className="text-muted-foreground text-sm">
              {!canEdit
                ? "You have read-only access to retention settings."
                : isDirty
                  ? "You have unsaved changes."
                  : "Everything is saved."}
            </p>
            <Button
              disabled={!canEdit || !isDirty}
              isLoading={updateBusiness.isPending}
              onClick={() => {
                // Shortening the window is the only change worth a confirm — it is
                // the one that puts more records on the path to deletion.
                if (policyChanged && policy !== "NEVER") setConfirmOpen(true);
                else void save();
              }}
            >
              Save policy
            </Button>
          </div>
        </CardContent>
      </Card>

      <ArchiveBatchesTable canManage={canEdit} />

      <ConfirmDialog
        open={isConfirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Switch to ${RETENTION_POLICY_LABELS[policy].toLowerCase()}?`}
        description={
          "Settled credits older than this window will be archived on the next sweep. Archiving is not deletion: the records are exported, kept for a further 90 days, and you are warned before anything is removed. You can restore any batch with one click."
        }
        confirmLabel="Save policy"
        isLoading={updateBusiness.isPending}
        onConfirm={save}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Archive batches
// ---------------------------------------------------------------------------
const STATE_VARIANTS: Record<
  ArchiveState,
  "neutral" | "info" | "warning" | "success" | "destructive"
> = {
  ARCHIVED: "info",
  PENDING_DELETION: "warning",
  POSTPONED: "neutral",
  RESTORED: "success",
  DELETED: "neutral",
};

/** Days remaining decides the tone. Under a week is genuinely urgent. */
function countdownTone(days: number): {
  variant: "neutral" | "warning" | "destructive";
  label: string;
} {
  if (days <= 0) return { variant: "destructive", label: "Due for deletion" };
  if (days <= 7)
    return { variant: "destructive", label: `${days} day${days === 1 ? "" : "s"} left` };
  if (days <= 30) return { variant: "warning", label: `${days} days left` };
  return { variant: "neutral", label: `${days} days left` };
}

function ArchiveBatchesTable({ canManage }: { canManage: boolean }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useArchiveBatches(page);
  const postpone = usePostponeDeletion();
  const restore = useRestoreArchive();

  const [restoring, setRestoring] = useState<ArchiveBatch | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const batches = data?.items ?? [];

  const onPostpone = async (batch: ArchiveBatch, days: number) => {
    try {
      await postpone.mutateAsync({ batchId: batch.id, days });
      toast.success(`Deletion pushed back by ${days} days.`, {
        description: "Nothing has been removed. You can postpone again at any time.",
      });
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError ? error.message : "Could not postpone deletion.",
      );
    }
  };

  const onRestore = async () => {
    if (!restoring) return;
    try {
      await restore.mutateAsync(restoring.id);
      toast.success("Records restored.", {
        description: `${formatNumber(restoring.recordCount)} records are back in your active lists.`,
      });
      setRestoring(null);
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError ? error.message : "Could not restore that batch.",
      );
    }
  };

  const onDownload = async (batch: ArchiveBatch) => {
    if (!batch.exportId) return;
    setDownloading(batch.id);
    try {
      await downloadFile(`/api/exports/${batch.exportId}/download`, `archive-${batch.id}.zip`);
      toast.success("Archive downloaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download that archive.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Archive className="size-4" aria-hidden="true" />
          Archived batches
        </CardTitle>
        <CardDescription>
          Records that have been moved out of your active lists. Download, postpone or restore
          them — right up until the deletion date.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <SkeletonTable rows={3} columns={5} />
        ) : isError ? (
          <p className="text-destructive-soft-foreground text-sm">
            Could not load your archive batches.
          </p>
        ) : batches.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Archive />}
            title="Nothing has been archived"
            description="When a settled credit passes your retention window it will appear here — and you will be emailed long before anything is deleted."
          />
        ) : (
          <>
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>State</TableHead>
                    <TableHead>Records</TableHead>
                    <TableHead>Deletion date</TableHead>
                    <TableHead>Countdown</TableHead>
                    <TableHead align="right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((batch) => {
                    const countdown = countdownTone(batch.daysUntilDeletion);
                    const isGone = batch.state === "DELETED";

                    return (
                      <TableRow key={batch.id}>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge variant={STATE_VARIANTS[batch.state]} dot>
                              {ARCHIVE_STATE_LABELS[batch.state]}
                            </Badge>
                            {batch.postponedCount > 0 ? (
                              <p className="text-muted-foreground text-xs">
                                Postponed {batch.postponedCount}×
                              </p>
                            ) : null}
                          </div>
                        </TableCell>

                        <TableCell>
                          <p className="text-sm font-medium tabular">
                            {formatNumber(batch.recordCount)}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {formatNumber(batch.creditCount)} credits ·{" "}
                            {formatNumber(batch.paymentCount)} payments ·{" "}
                            {formatBytes(batch.storageBytes)}
                          </p>
                        </TableCell>

                        <TableCell>
                          <p className="flex items-center gap-1.5 text-sm">
                            <CalendarClock
                              className="text-muted-foreground size-3.5"
                              aria-hidden="true"
                            />
                            {formatDate(batch.deleteScheduledFor)}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {batch.warningsSent.length > 0
                              ? `${batch.warningsSent.length} warning${batch.warningsSent.length === 1 ? "" : "s"} sent`
                              : "No warnings sent yet"}
                          </p>
                        </TableCell>

                        <TableCell>
                          {isGone ? (
                            <span className="text-muted-foreground text-sm">Deleted</span>
                          ) : (
                            <Badge variant={countdown.variant} dot>
                              <Timer className="size-3" aria-hidden="true" />
                              {countdown.label}
                            </Badge>
                          )}
                        </TableCell>

                        <TableCell align="right">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {batch.exportId ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                leftIcon={<Download />}
                                isLoading={downloading === batch.id}
                                onClick={() => void onDownload(batch)}
                              >
                                Download
                              </Button>
                            ) : null}

                            {canManage && !isGone ? (
                              <>
                                <label
                                  className="sr-only"
                                  htmlFor={`postpone-${batch.id}`}
                                >
                                  Postpone deletion of this batch
                                </label>
                                <Select
                                  id={`postpone-${batch.id}`}
                                  selectSize="sm"
                                  className="w-auto min-w-32"
                                  value=""
                                  disabled={postpone.isPending}
                                  onChange={(event) => {
                                    const days = Number(event.target.value);
                                    if (days > 0) void onPostpone(batch, days);
                                    event.target.value = "";
                                  }}
                                  options={[
                                    { value: "", label: "Postpone…" },
                                    { value: "7", label: "+ 7 days" },
                                    { value: "30", label: "+ 30 days" },
                                    { value: "90", label: "+ 90 days" },
                                  ]}
                                />
                              </>
                            ) : null}

                            {canManage && batch.canRestore ? (
                              <Button
                                variant="outline"
                                size="sm"
                                leftIcon={<RotateCcw />}
                                onClick={() => setRestoring(batch)}
                              >
                                Restore
                              </Button>
                            ) : null}
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
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={() => setRestoring(null)}
        title="Restore these records?"
        description={`${formatNumber(restoring?.recordCount ?? 0)} records will move back into your active credits and payments lists, exactly as they were. Nothing is lost either way — this is safe.`}
        confirmLabel="Restore them"
        isLoading={restore.isPending}
        onConfirm={onRestore}
      />
    </Card>
  );
}
