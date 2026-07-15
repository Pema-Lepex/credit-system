"use client";

/**
 * TanStack Query bindings for the catalog.
 *
 * Categories are invalidated by product/service writes too: deleting a category
 * uncategorises its members, and creating a product can be the first thing that
 * makes a category non-empty. One root key per entity, invalidated together.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import { gqlRequest } from "@/lib/graphql/client";
import type { ID, Money } from "@/types";

import {
  ADJUST_STOCK_MUTATION,
  CATEGORIES_QUERY,
  CREATE_CATEGORY_MUTATION,
  CREATE_PRODUCT_MUTATION,
  CREATE_SERVICE_MUTATION,
  DELETE_CATEGORY_MUTATION,
  DELETE_PRODUCT_MUTATION,
  DELETE_SERVICE_MUTATION,
  PRODUCTS_QUERY,
  PRODUCT_QUERY,
  SERVICES_QUERY,
  SERVICE_QUERY,
  UPDATE_CATEGORY_MUTATION,
  UPDATE_PRODUCT_MUTATION,
  UPDATE_SERVICE_MUTATION,
  type AdjustStockResult,
  type CategoriesResult,
  type CategoryInput,
  type CategoryRecord,
  type CreateCategoryResult,
  type CreateProductResult,
  type CreateServiceResult,
  type DeleteCategoryResult,
  type DeleteProductResult,
  type DeleteServiceResult,
  type PageInput,
  type ProductFilterInput,
  type ProductInput,
  type ProductRecord,
  type ProductResult,
  type ProductsResult,
  type ServiceFilterInput,
  type ServiceInput,
  type ServiceRecord,
  type ServiceResult,
  type ServicesResult,
  type SortInput,
  type UpdateCategoryResult,
  type UpdateProductResult,
  type UpdateServiceResult,
} from "./api";

export const catalogKeys = {
  products: ["catalog", "products"] as const,
  productList: (filter: ProductFilterInput, page: PageInput, sort: SortInput) =>
    ["catalog", "products", "list", filter, page, sort] as const,
  product: (id: ID) => ["catalog", "products", "detail", id] as const,
  services: ["catalog", "services"] as const,
  serviceList: (filter: ServiceFilterInput, page: PageInput, sort: SortInput) =>
    ["catalog", "services", "list", filter, page, sort] as const,
  service: (id: ID) => ["catalog", "services", "detail", id] as const,
  categories: ["catalog", "categories"] as const,
};

function useInvalidateCatalog() {
  const queryClient = useQueryClient();
  return (...keys: readonly (readonly unknown[])[]) => {
    keys.forEach((queryKey) => void queryClient.invalidateQueries({ queryKey }));
  };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
export function useCategories() {
  return useQuery({
    queryKey: catalogKeys.categories,
    queryFn: () =>
      gqlRequest<CategoriesResult>(CATEGORIES_QUERY, {}).then((d) => d.categories),
    staleTime: 5 * 60_000,
  });
}

export function useCreateCategory(): UseMutationResult<CategoryRecord, unknown, CategoryInput> {
  const invalidate = useInvalidateCatalog();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CategoryInput) =>
      gqlRequest<CreateCategoryResult>(CREATE_CATEGORY_MUTATION, { input }).then(
        (d) => d.createCategory,
      ),
    onSuccess: (created) => {
      // Write the new row straight into the cache, sorted by name, before the
      // refetch settles. This makes "add another category" reliable even if the
      // background refetch is briefly deduped, in flight, or momentarily stale —
      // the second, third, fourth category all appear immediately.
      queryClient.setQueryData<CategoryRecord[]>(catalogKeys.categories, (prev) => {
        const next = [...(prev ?? []).filter((c) => c.id !== created.id), created];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
      invalidate(catalogKeys.categories);
    },
  });
}

export function useUpdateCategory(): UseMutationResult<
  CategoryRecord,
  unknown,
  { id: ID; input: CategoryInput }
> {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ id, input }: { id: ID; input: CategoryInput }) =>
      gqlRequest<UpdateCategoryResult>(UPDATE_CATEGORY_MUTATION, { id, input }).then(
        (d) => d.updateCategory,
      ),
    // A renamed category is embedded in every product row that belongs to it.
    onSuccess: () =>
      invalidate(catalogKeys.categories, catalogKeys.products, catalogKeys.services),
  });
}

export function useDeleteCategory(): UseMutationResult<
  DeleteCategoryResult["deleteCategory"],
  unknown,
  ID
> {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (id: ID) =>
      gqlRequest<DeleteCategoryResult>(DELETE_CATEGORY_MUTATION, { id }).then(
        (d) => d.deleteCategory,
      ),
    onSuccess: () =>
      invalidate(catalogKeys.categories, catalogKeys.products, catalogKeys.services),
  });
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export function useProducts(filter: ProductFilterInput, page: PageInput, sort: SortInput) {
  return useQuery({
    queryKey: catalogKeys.productList(filter, page, sort),
    queryFn: () =>
      gqlRequest<ProductsResult>(PRODUCTS_QUERY, { filter, page, sort }).then((d) => d.products),
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: ID) {
  return useQuery({
    queryKey: catalogKeys.product(id),
    queryFn: () => gqlRequest<ProductResult>(PRODUCT_QUERY, { id }).then((d) => d.product),
    enabled: Boolean(id),
  });
}

export function useCreateProduct(): UseMutationResult<ProductRecord, unknown, ProductInput> {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (input: ProductInput) =>
      gqlRequest<CreateProductResult>(CREATE_PRODUCT_MUTATION, { input }).then(
        (d) => d.createProduct,
      ),
    onSuccess: () => invalidate(catalogKeys.products),
  });
}

export function useUpdateProduct(id: ID): UseMutationResult<ProductRecord, unknown, ProductInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductInput) =>
      gqlRequest<UpdateProductResult>(UPDATE_PRODUCT_MUTATION, { id, input }).then(
        (d) => d.updateProduct,
      ),
    onSuccess: (product) => {
      queryClient.setQueryData(catalogKeys.product(id), product);
      void queryClient.invalidateQueries({ queryKey: catalogKeys.products });
    },
  });
}

export function useDeleteProduct(): UseMutationResult<
  DeleteProductResult["deleteProduct"],
  unknown,
  ID
> {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (id: ID) =>
      gqlRequest<DeleteProductResult>(DELETE_PRODUCT_MUTATION, { id }).then(
        (d) => d.deleteProduct,
      ),
    onSuccess: () => invalidate(catalogKeys.products),
  });
}

export interface AdjustStockVars {
  id: ID;
  /** A signed decimal STRING: "-3", "12.5". Never a float. */
  delta: Money;
  reason?: string | null;
}

export function useAdjustStock(): UseMutationResult<ProductRecord, unknown, AdjustStockVars> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, delta, reason }: AdjustStockVars) =>
      gqlRequest<AdjustStockResult>(ADJUST_STOCK_MUTATION, {
        id,
        delta,
        reason: reason ?? null,
      }).then((d) => d.adjustStock),
    onSuccess: (product) => {
      queryClient.setQueryData(catalogKeys.product(product.id), product);
      void queryClient.invalidateQueries({ queryKey: catalogKeys.products });
    },
  });
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
export function useServices(filter: ServiceFilterInput, page: PageInput, sort: SortInput) {
  return useQuery({
    queryKey: catalogKeys.serviceList(filter, page, sort),
    queryFn: () =>
      gqlRequest<ServicesResult>(SERVICES_QUERY, { filter, page, sort }).then((d) => d.services),
    placeholderData: keepPreviousData,
  });
}

export function useService(id: ID) {
  return useQuery({
    queryKey: catalogKeys.service(id),
    queryFn: () => gqlRequest<ServiceResult>(SERVICE_QUERY, { id }).then((d) => d.service),
    enabled: Boolean(id),
  });
}

export function useCreateService(): UseMutationResult<ServiceRecord, unknown, ServiceInput> {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (input: ServiceInput) =>
      gqlRequest<CreateServiceResult>(CREATE_SERVICE_MUTATION, { input }).then(
        (d) => d.createService,
      ),
    onSuccess: () => invalidate(catalogKeys.services),
  });
}

export function useUpdateService(id: ID): UseMutationResult<ServiceRecord, unknown, ServiceInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ServiceInput) =>
      gqlRequest<UpdateServiceResult>(UPDATE_SERVICE_MUTATION, { id, input }).then(
        (d) => d.updateService,
      ),
    onSuccess: (service) => {
      queryClient.setQueryData(catalogKeys.service(id), service);
      void queryClient.invalidateQueries({ queryKey: catalogKeys.services });
    },
  });
}

export function useDeleteService(): UseMutationResult<
  DeleteServiceResult["deleteService"],
  unknown,
  ID
> {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (id: ID) =>
      gqlRequest<DeleteServiceResult>(DELETE_SERVICE_MUTATION, { id }).then(
        (d) => d.deleteService,
      ),
    onSuccess: () => invalidate(catalogKeys.services),
  });
}
