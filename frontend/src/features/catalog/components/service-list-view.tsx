"use client";

import type { ColumnDef, SortingState, Updater } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  buttonVariants,
  toast,
} from "@/components/ui";
import { DataTable, stopRowClick } from "@/features/common/data-table";
import { toServerError } from "@/features/common/errors";
import { useCurrency } from "@/features/common/use-currency";
import { useAuth } from "@/lib/auth/AuthProvider";

import type { ServiceRecord } from "../api";
import { useDeleteService, useServices } from "../queries";
import { useServiceFilters, type ServiceSortField } from "../use-catalog-filters";
import { CatalogFilters } from "./catalog-filters";
import { CategoryManager } from "./category-manager";

const SORTABLE: Record<string, ServiceSortField> = { name: "name", price: "price" };

function formatDuration(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function ServiceListView() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const currency = useCurrency();
  const filters = useServiceFilters();

  const { data, isLoading, isFetching, error } = useServices(
    filters.variables.filter,
    filters.variables.page,
    filters.variables.sort,
  );
  const deleteService = useDeleteService();

  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [deleting, setDeleting] = useState<ServiceRecord | null>(null);

  const canWrite = hasPermission("catalog:write");
  const canDelete = hasPermission("catalog:delete");

  const sorting = useMemo<SortingState>(
    () => [{ id: filters.sortField, desc: filters.sortDesc }],
    [filters.sortField, filters.sortDesc],
  );

  const { setSort } = filters;
  const onSortingChange = useCallback(
    (updater: Updater<SortingState>) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      if (!first) return;
      const field = SORTABLE[first.id];
      if (field) setSort(field, first.desc);
    },
    [setSort, sorting],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    try {
      await deleteService.mutateAsync(deleting.id);
      toast.success(`${deleting.name} deleted.`);
    } catch (mutationError) {
      toast.error(toServerError(mutationError).message);
    } finally {
      setDeleting(null);
    }
  }, [deleteService, deleting]);

  const actions = useCallback(
    (service: ServiceRecord) => (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for ${service.name}`}
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label={`Actions for ${service.name}`}>
          {canWrite ? (
            <DropdownMenuItem
              icon={<Pencil />}
              onSelect={() => router.push(`/services/${service.id}/edit`)}
            >
              Edit
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => setDeleting(service)}>
              Delete
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    [canDelete, canWrite, router],
  );

  const columns = useMemo<ColumnDef<ServiceRecord, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Service",
        enableSorting: true,
        cell: ({ row }) => {
          const service = row.original;
          return (
            <div className="min-w-0">
              <p className="text-foreground truncate font-medium">{service.name}</p>
              <p className="text-muted-foreground truncate text-xs">
                {service.code ?? "No code"}
                {service.category ? ` · ${service.category.name}` : ""}
              </p>
            </div>
          );
        },
      },
      {
        id: "price",
        header: "Price",
        enableSorting: true,
        meta: { numeric: true, align: "right" as const },
        cell: ({ row }) => (
          <span className="font-medium">{currency.format(row.original.price)}</span>
        ),
      },
      {
        id: "duration",
        header: "Duration",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular whitespace-nowrap">
            {formatDuration(row.original.durationMinutes)}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.isActive ? (
            <Badge variant="success" size="sm" dot>
              Active
            </Badge>
          ) : (
            <Badge variant="neutral" size="sm" dot>
              Inactive
            </Badge>
          ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        meta: { align: "right" as const },
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={stopRowClick}>
            {actions(row.original)}
          </div>
        ),
      },
    ],
    [actions, currency],
  );

  return (
    <div className="space-y-4">
      <CatalogFilters
        kind="service"
        filters={filters}
        onManageCategories={() => setCategoriesOpen(true)}
      />

      {error ? (
        <Alert variant="destructive" title="Could not load services">
          {toServerError(error).message}
        </Alert>
      ) : (
        <DataTable
          label="Services"
          data={data?.items ?? []}
          columns={columns}
          getRowId={(row) => row.id}
          sorting={sorting}
          onSortingChange={onSortingChange}
          page={filters.page}
          pageSize={filters.limit}
          totalItems={data?.pageInfo.total ?? 0}
          onPageChange={filters.setPage}
          onPageSizeChange={filters.setLimit}
          isLoading={isLoading}
          isFetching={isFetching}
          onRowClick={canWrite ? (row) => router.push(`/services/${row.id}/edit`) : undefined}
          renderCard={(service) => (
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-foreground truncate font-medium">{service.name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {service.code ?? "No code"}
                    {service.category ? ` · ${service.category.name}` : ""}
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="tabular text-foreground font-semibold">
                      {currency.format(service.price)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatDuration(service.durationMinutes)}
                    </span>
                    {!service.isActive ? (
                      <Badge variant="neutral" size="sm">
                        Inactive
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0">{actions(service)}</div>
              </div>
            </Card>
          )}
          emptyState={
            <EmptyState
              icon={<Wrench />}
              title={filters.isFiltered ? "No services match those filters" : "No services yet"}
              description={
                filters.isFiltered
                  ? "Try another category, or clear the filters."
                  : "Add the services you offer on credit."
              }
              action={
                filters.isFiltered ? (
                  <Button variant="outline" onClick={filters.clear}>
                    Clear filters
                  </Button>
                ) : canWrite ? (
                  <Link href="/services/new" className={buttonVariants()}>
                    <Plus />
                    New service
                  </Link>
                ) : null
              }
            />
          }
        />
      )}

      <CategoryManager open={categoriesOpen} onOpenChange={setCategoriesOpen} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title={`Delete ${deleting?.name ?? "service"}?`}
        description="Past credits keep their own copy of the name and price, so history is not rewritten."
        confirmLabel="Delete"
        destructive
        isLoading={deleteService.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
