"use client";

import type { ColumnDef, SortingState, Updater } from "@tanstack/react-table";
import {
  AlertTriangle,
  MoreHorizontal,
  Package,
  PackagePlus,
  Pencil,
  Boxes,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

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
  Pagination,
  Skeleton,
  buttonVariants,
  toast,
} from "@/components/ui";
import { DataTable, stopRowClick } from "@/features/common/data-table";
import { toServerError } from "@/features/common/errors";
import { assetUrl } from "@/features/common/media";
import { useCurrency } from "@/features/common/use-currency";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn, formatNumber } from "@/lib/utils";

import type { ProductRecord } from "../api";
import { useDeleteProduct, useProducts } from "../queries";
import { useProductFilters, type ProductSortField } from "../use-catalog-filters";
import { CatalogFilters } from "./catalog-filters";
import { CategoryManager } from "./category-manager";
import { StockAdjustDialog } from "./stock-adjust-dialog";

const SORTABLE: Record<string, ProductSortField> = {
  name: "name",
  price: "price",
  stock_quantity: "stock_quantity",
};

export function ProductListView() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const currency = useCurrency();
  const filters = useProductFilters();

  const { data, isLoading, isFetching, error } = useProducts(
    filters.variables.filter,
    filters.variables.page,
    filters.variables.sort,
  );
  const deleteProduct = useDeleteProduct();

  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<ProductRecord | null>(null);
  const [deleting, setDeleting] = useState<ProductRecord | null>(null);

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
      await deleteProduct.mutateAsync(deleting.id);
      toast.success(`${deleting.name} deleted.`);
    } catch (mutationError) {
      toast.error(toServerError(mutationError).message);
    } finally {
      setDeleting(null);
    }
  }, [deleteProduct, deleting]);

  const actions = useCallback(
    (product: ProductRecord) => (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for ${product.name}`}
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label={`Actions for ${product.name}`}>
          {canWrite ? (
            <DropdownMenuItem
              icon={<Pencil />}
              onSelect={() => router.push(`/products/${product.id}/edit`)}
            >
              Edit
            </DropdownMenuItem>
          ) : null}
          {canWrite ? (
            <DropdownMenuItem icon={<Boxes />} onSelect={() => setAdjusting(product)}>
              Adjust stock
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => setDeleting(product)}>
              Delete
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    [canDelete, canWrite, router],
  );

  const columns = useMemo<ColumnDef<ProductRecord, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Product",
        enableSorting: true,
        cell: ({ row }) => {
          const product = row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <Thumbnail product={product} size={36} />
              <div className="min-w-0">
                <p className="text-foreground truncate font-medium">{product.name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {product.sku ?? "No SKU"}
                  {product.category ? ` · ${product.category.name}` : ""}
                </p>
              </div>
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
        id: "stock_quantity",
        header: "Stock",
        enableSorting: true,
        meta: { numeric: true, align: "right" as const },
        cell: ({ row }) => <StockCell product={row.original} />,
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

  const products = data?.items ?? [];
  const total = data?.pageInfo.total ?? 0;

  const emptyState = (
    <EmptyState
      icon={<Package />}
      title={filters.isFiltered ? "No products match those filters" : "No products yet"}
      description={
        filters.isFiltered
          ? "Try another category, or clear the low-stock filter."
          : "Add the goods you sell on credit."
      }
      action={
        filters.isFiltered ? (
          <Button variant="outline" onClick={filters.clear}>
            Clear filters
          </Button>
        ) : canWrite ? (
          <Link href="/products/new" className={buttonVariants()}>
            <PackagePlus />
            New product
          </Link>
        ) : null
      }
    />
  );

  return (
    <div className="space-y-4">
      <CatalogFilters
        kind="product"
        filters={filters}
        onManageCategories={() => setCategoriesOpen(true)}
      />

      {error ? (
        <Alert variant="destructive" title="Could not load products">
          {toServerError(error).message}
        </Alert>
      ) : filters.view === "grid" ? (
        <ProductGrid
          products={products}
          isLoading={isLoading}
          isFetching={isFetching}
          emptyState={emptyState}
          format={currency.format}
          actions={actions}
          page={filters.page}
          pageSize={filters.limit}
          totalItems={total}
          onPageChange={filters.setPage}
          onPageSizeChange={filters.setLimit}
        />
      ) : (
        <DataTable
          label="Products"
          data={products}
          columns={columns}
          getRowId={(row) => row.id}
          sorting={sorting}
          onSortingChange={onSortingChange}
          page={filters.page}
          pageSize={filters.limit}
          totalItems={total}
          onPageChange={filters.setPage}
          onPageSizeChange={filters.setLimit}
          isLoading={isLoading}
          isFetching={isFetching}
          onRowClick={canWrite ? (row) => router.push(`/products/${row.id}/edit`) : undefined}
          renderCard={(product) => (
            <ProductCard product={product} format={currency.format} actions={actions} />
          )}
          emptyState={emptyState}
        />
      )}

      <CategoryManager open={categoriesOpen} onOpenChange={setCategoriesOpen} />
      <StockAdjustDialog
        product={adjusting}
        onOpenChange={(open) => (open ? undefined : setAdjusting(null))}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title={`Delete ${deleting?.name ?? "product"}?`}
        description="Past credits keep their own copy of the name and price, so history is not rewritten."
        confirmLabel="Delete"
        destructive
        isLoading={deleteProduct.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
function Thumbnail({ product, size }: { product: ProductRecord; size: number }) {
  // The API serves images from its own origin — a bare "/api/files/…" would be
  // requested from Next and 404.
  const src = assetUrl(product.imageUrls[0]);

  if (!src) {
    return (
      <span
        aria-hidden="true"
        style={{ width: size, height: size }}
        className="bg-muted text-muted-foreground border-border flex shrink-0 items-center justify-center rounded-md border"
      >
        <Package className="size-4" />
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      unoptimized
      style={{ width: size, height: size }}
      className="border-border shrink-0 rounded-md border object-cover"
    />
  );
}

function StockCell({ product }: { product: ProductRecord }) {
  const quantity = Number(product.stockQuantity);

  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      {product.isLowStock ? (
        <AlertTriangle
          className="text-warning-soft-foreground size-3.5"
          aria-label="Low stock"
        />
      ) : null}
      <span
        className={cn(
          "font-medium",
          quantity < 0
            ? "text-destructive-soft-foreground"
            : product.isLowStock
              ? "text-warning-soft-foreground"
              : "text-foreground",
        )}
      >
        {formatNumber(product.stockQuantity)}
      </span>
      <span className="text-muted-foreground text-xs">{product.unit}</span>
    </span>
  );
}

function ProductCard({
  product,
  format,
  actions,
}: {
  product: ProductRecord;
  format: (amount: string) => string;
  actions: (product: ProductRecord) => React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Thumbnail product={product} size={56} />
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate font-medium">{product.name}</p>
          <p className="text-muted-foreground truncate text-xs">
            {product.sku ?? "No SKU"}
            {product.category ? ` · ${product.category.name}` : ""}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="tabular text-foreground font-semibold">{format(product.price)}</span>
            <StockCell product={product} />
          </div>
        </div>
        <div className="shrink-0">{actions(product)}</div>
      </div>
    </Card>
  );
}

interface ProductGridProps {
  products: ProductRecord[];
  isLoading: boolean;
  isFetching: boolean;
  emptyState: React.ReactNode;
  format: (amount: string) => string;
  actions: (product: ProductRecord) => React.ReactNode;
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

/** A shop thinks in shelves, not rows. Same data, same actions, bigger pictures. */
function ProductGrid({
  products,
  isLoading,
  isFetching,
  emptyState,
  format,
  actions,
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: ProductGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-56 rounded-lg" />
        ))}
      </div>
    );
  }

  if (products.length === 0) return <>{emptyState}</>;

  return (
    <div className="space-y-4">
      <ul
        aria-label="Products"
        className={cn(
          "grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4",
          isFetching && "opacity-60 transition-opacity",
        )}
      >
        {products.map((product) => {
          const image = assetUrl(product.imageUrls[0]);
          return (
          <li key={product.id}>
            <Card interactive className="group h-full overflow-hidden">
              <div className="bg-muted relative aspect-square w-full overflow-hidden">
                {image ? (
                  <Image
                    src={image}
                    alt=""
                    fill
                    unoptimized
                    sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <span className="text-muted-foreground absolute inset-0 flex items-center justify-center">
                    <Package className="size-8" aria-hidden="true" />
                  </span>
                )}

                <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                  {!product.isActive ? (
                    <Badge variant="neutral" size="sm">
                      Inactive
                    </Badge>
                  ) : null}
                  {product.isLowStock ? (
                    <Badge variant="warning" size="sm">
                      Low stock
                    </Badge>
                  ) : null}
                </div>
              </div>

              <CardContent className="space-y-1 p-3">
                <div className="flex items-start justify-between gap-1">
                  <p className="text-foreground line-clamp-2 min-w-0 text-sm font-medium">
                    {product.name}
                  </p>
                  <div className="-mt-1 -mr-1 shrink-0">{actions(product)}</div>
                </div>
                <p className="text-muted-foreground truncate text-xs">
                  {product.sku ?? "No SKU"}
                  {product.category ? ` · ${product.category.name}` : ""}
                </p>
                <div className="flex items-baseline justify-between pt-1">
                  <span className="tabular text-foreground font-semibold">
                    {format(product.price)}
                  </span>
                  <span className="text-muted-foreground tabular text-xs">
                    {formatNumber(product.stockQuantity)} {product.unit}
                  </span>
                </div>
              </CardContent>
            </Card>
          </li>
          );
        })}
      </ul>

      <Pagination
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        isLoading={isFetching}
      />
    </div>
  );
}
