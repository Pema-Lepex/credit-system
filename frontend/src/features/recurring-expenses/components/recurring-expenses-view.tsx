"use client";

import { MoreHorizontal, Pause, Pencil, Play, Plus, RefreshCw, Repeat, Trash2, Zap } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/layout/page-header";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import { parseApiError } from "@/features/credits/lib/errors";
import {
  FREQUENCY_LABELS,
  RecurringExpenseFormDialog,
} from "@/features/recurring-expenses/components/recurring-expense-form-dialog";
import {
  useDeleteRecurringExpense,
  useRecurringExpenses,
  useRunRecurringExpenses,
  useSetRecurringExpenseActive,
} from "@/features/recurring-expenses/hooks";
import type { RecurringExpenseRow } from "@/features/recurring-expenses/queries";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn, formatDate } from "@/lib/utils";

export function RecurringExpensesView() {
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RecurringExpenseRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecurringExpenseRow | null>(null);

  const money = useMoney();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("recurring_expense:manage");

  const query = useRecurringExpenses();
  const setActive = useSetRecurringExpenseActive();
  const deleteTemplate = useDeleteRecurringExpense();
  const runNow = useRunRecurringExpenses();
  const page = query.data;

  const openCreate = () => {
    setEditTarget(null);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Repeating bills"
        description="Rent, wages, electricity — anything you pay on a schedule. We record each one for you when it falls due, so nothing is forgotten."
        actions={
          canManage ? (
            <>
              <Button
                variant="secondary"
                leftIcon={<Zap />}
                isLoading={runNow.isPending}
                loadingText="Checking…"
                onClick={() => void runNow.mutateAsync()}
              >
                Record due now
              </Button>
              <Button leftIcon={<Plus />} onClick={openCreate}>
                Add repeating bill
              </Button>
            </>
          ) : null
        }
      />

      {query.isError ? (
        <Alert variant="destructive" title="Could not load your repeating bills">
          <p>{parseApiError(query.error).message}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            leftIcon={<RefreshCw />}
            isLoading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </Alert>
      ) : query.isPending ? (
        <Card>
          <CardContent className="pt-6">
            <SkeletonTable rows={5} columns={5} />
          </CardContent>
        </Card>
      ) : page && page.items.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={<Repeat />}
              title="No repeating bills yet"
              description="Set up the costs that come round every month and they will appear in your expenses automatically — no reminders to yourself needed."
              action={
                canManage ? (
                  <Button leftIcon={<Plus />} onClick={openCreate}>
                    Add your first one
                  </Button>
                ) : null
              }
            />
          </CardContent>
        </Card>
      ) : page ? (
        <div className={cn(query.isFetching && "opacity-70 transition-opacity")}>
          <TableContainer className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>What</TableHead>
                  <TableHead>How often</TableHead>
                  <TableHead align="right">Amount</TableHead>
                  <TableHead>Next due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((template) => (
                  <TableRow key={template.id} className={cn(!template.isActive && "opacity-70")}>
                    <TableCell>
                      <span className="font-medium">{template.name}</span>
                      {template.vendorName ? (
                        <span className="text-muted-foreground block text-xs">
                          to {template.vendorName}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {FREQUENCY_LABELS[template.frequency]}
                    </TableCell>
                    <TableCell numeric className="font-medium">
                      {money.format(template.amount)}
                    </TableCell>
                    <TableCell className="tabular">{formatDate(template.nextRun)}</TableCell>
                    <TableCell>
                      <Badge size="sm" variant={template.isActive ? "success" : "neutral"}>
                        {template.isActive ? "Active" : "Paused"}
                      </Badge>
                    </TableCell>
                    <TableCell className="w-px text-right">
                      {canManage ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={`Actions for ${template.name}`}
                            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                          >
                            <MoreHorizontal aria-hidden="true" className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              icon={<Pencil />}
                              onSelect={() => {
                                setEditTarget(template);
                                setFormOpen(true);
                              }}
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              icon={template.isActive ? <Pause /> : <Play />}
                              onSelect={() =>
                                void setActive.mutateAsync({
                                  id: template.id,
                                  isActive: !template.isActive,
                                })
                              }
                            >
                              {template.isActive ? "Pause" : "Resume"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              icon={<Trash2 />}
                              destructive
                              onSelect={() => setDeleteTarget(template)}
                            >
                              Stop for good
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* ------------------------------------------------------------ mobile */}
          <ul className="space-y-3 md:hidden">
            {page.items.map((template) => (
              <li
                key={template.id}
                className={cn(
                  "border-border bg-card rounded-lg border p-4 shadow-xs",
                  !template.isActive && "opacity-70",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-foreground truncate font-medium">{template.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {FREQUENCY_LABELS[template.frequency]} · next {formatDate(template.nextRun)}
                    </p>
                  </div>
                  <p className="text-foreground shrink-0 font-semibold tabular">
                    {money.format(template.amount)}
                  </p>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <Badge size="sm" variant={template.isActive ? "success" : "neutral"}>
                    {template.isActive ? "Active" : "Paused"}
                  </Badge>
                  {template.vendorName ? (
                    <span className="text-muted-foreground text-xs">
                      to {template.vendorName}
                    </span>
                  ) : null}
                </div>

                {canManage ? (
                  <div className="mt-3 flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setEditTarget(template);
                        setFormOpen(true);
                      }}
                      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium"
                    >
                      <Pencil aria-hidden="true" className="size-3.5" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void setActive.mutateAsync({
                          id: template.id,
                          isActive: !template.isActive,
                        })
                      }
                      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium"
                    >
                      {template.isActive ? (
                        <Pause aria-hidden="true" className="size-3.5" />
                      ) : (
                        <Play aria-hidden="true" className="size-3.5" />
                      )}
                      {template.isActive ? "Pause" : "Resume"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(template)}
                      className="text-destructive-soft-foreground ml-auto inline-flex items-center gap-1.5 text-xs font-medium"
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                      Stop
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <RecurringExpenseFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditTarget(null);
        }}
        template={editTarget}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Stop this repeating bill?"
        description={
          deleteTarget ? (
            <>
              <strong>{deleteTarget.name}</strong> will stop creating new expenses. Everything it
              has already recorded is kept — this is like cancelling a standing order, not undoing
              last month&apos;s payment. If you only want a break, pause it instead.
            </>
          ) : null
        }
        confirmLabel="Stop it"
        destructive
        isLoading={deleteTemplate.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteTemplate.mutateAsync(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
