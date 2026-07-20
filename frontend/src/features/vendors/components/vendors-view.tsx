"use client";

import { MoreHorizontal, Pencil, Plus, RefreshCw, Search, Trash2, Truck } from "lucide-react";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/layout/page-header";
import {
  Alert,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { parseApiError } from "@/features/credits/lib/errors";
import { VendorFormDialog } from "@/features/vendors/components/vendor-form-dialog";
import { useDeleteVendor, useVendors } from "@/features/vendors/hooks";
import type { VendorRow } from "@/features/vendors/queries";
import { useAuth } from "@/lib/auth/AuthProvider";

export function VendorsView() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VendorRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VendorRow | null>(null);

  const { hasPermission } = useAuth();
  const canWrite = hasPermission("vendor:write");
  const canDelete = hasPermission("vendor:delete");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useVendors({ search: debounced });
  const deleteVendor = useDeleteVendor();
  const page = query.data;

  const openCreate = () => {
    setEditTarget(null);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Everyone the business pays. Picking a supplier on an expense keeps your spending reports tidy."
        actions={
          canWrite ? (
            <Button leftIcon={<Plus />} onClick={openCreate}>
              Add supplier
            </Button>
          ) : null
        }
      />

      <div className="max-w-sm">
        <label htmlFor="vendor-search" className="sr-only">
          Search suppliers
        </label>
        <Input
          id="vendor-search"
          type="search"
          placeholder="Search by name, phone or email…"
          leftAddon={<Search />}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {query.isError ? (
        <Alert variant="destructive" title="Could not load your suppliers">
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
            <SkeletonTable rows={6} columns={4} />
          </CardContent>
        </Card>
      ) : page && page.items.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={<Truck />}
              title={debounced ? "No supplier matches that" : "No suppliers yet"}
              description={
                debounced
                  ? "Try a different name, phone number or email."
                  : "Add the people you buy from, and your expense reports will show exactly where the money goes."
              }
              action={
                canWrite && !debounced ? (
                  <Button leftIcon={<Plus />} onClick={openCreate}>
                    Add your first supplier
                  </Button>
                ) : null
              }
            />
          </CardContent>
        </Card>
      ) : page ? (
        <>
          <TableContainer className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((vendor) => (
                  <TableRow key={vendor.id}>
                    <TableCell className="font-medium">{vendor.name}</TableCell>
                    <TableCell className="text-muted-foreground">{vendor.phone ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{vendor.email ?? "—"}</TableCell>
                    <TableCell className="w-px text-right">
                      {canWrite || canDelete ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={`Actions for ${vendor.name}`}
                            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                          >
                            <MoreHorizontal aria-hidden="true" className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {canWrite ? (
                              <DropdownMenuItem
                                icon={<Pencil />}
                                onSelect={() => {
                                  setEditTarget(vendor);
                                  setFormOpen(true);
                                }}
                              >
                                Edit supplier
                              </DropdownMenuItem>
                            ) : null}
                            {canDelete ? (
                              <DropdownMenuItem
                                icon={<Trash2 />}
                                destructive
                                onSelect={() => setDeleteTarget(vendor)}
                              >
                                Remove supplier
                              </DropdownMenuItem>
                            ) : null}
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
            {page.items.map((vendor) => (
              <li key={vendor.id} className="border-border bg-card rounded-lg border p-4 shadow-xs">
                <p className="text-foreground font-medium">{vendor.name}</p>
                {vendor.phone || vendor.email ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {[vendor.phone, vendor.email].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {canWrite || canDelete ? (
                  <div className="mt-3 flex gap-3">
                    {canWrite ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditTarget(vendor);
                          setFormOpen(true);
                        }}
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium"
                      >
                        <Pencil aria-hidden="true" className="size-3.5" />
                        Edit
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(vendor)}
                        className="text-destructive-soft-foreground ml-auto inline-flex items-center gap-1.5 text-xs font-medium"
                      >
                        <Trash2 aria-hidden="true" className="size-3.5" />
                        Remove
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <VendorFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditTarget(null);
        }}
        vendor={editTarget}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Remove this supplier?"
        description={
          deleteTarget ? (
            <>
              <strong>{deleteTarget.name}</strong> will stop appearing when you record an expense.
              Expenses you already paid them keep the name, so your reports and history stay
              exactly as they are.
            </>
          ) : null
        }
        confirmLabel="Remove supplier"
        destructive
        isLoading={deleteVendor.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteVendor.mutateAsync(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
