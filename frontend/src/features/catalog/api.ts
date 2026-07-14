/**
 * Catalog GraphQL documents — products, services, categories.
 *
 * Written against docs/schema.graphql. Prices, cost, tax %, stock and thresholds
 * are all String on the wire (Python Decimal), and they stay strings here.
 * `stockQuantity` in particular is a *decimal* string like "9.000" — it is a
 * quantity in kilos as often as it is a count of tins.
 */

import type { ID, ISODateTime, Money } from "@/types";

import type { PageInfo, PageInput, SortInput } from "@/features/customers/api";

export type { PageInfo, PageInput, SortInput };

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------
export interface CategoryRecord {
  id: ID;
  name: string;
  description: string | null;
  color: string | null;
  createdAt: ISODateTime;
}

export interface ProductRecord {
  id: ID;
  name: string;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  categoryId: ID | null;
  category: CategoryRecord | null;
  price: Money;
  costPrice: Money | null;
  taxPercentage: Money | null;
  stockQuantity: Money;
  lowStockThreshold: Money | null;
  unit: string;
  imageUrls: string[];
  isActive: boolean;
  isLowStock: boolean;
  createdAt: ISODateTime;
}

export interface ServiceRecord {
  id: ID;
  name: string;
  code: string | null;
  description: string | null;
  categoryId: ID | null;
  category: CategoryRecord | null;
  price: Money;
  taxPercentage: Money | null;
  durationMinutes: number | null;
  isActive: boolean;
  createdAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
export interface ProductFilterInput {
  search?: string | null;
  categoryId?: ID | null;
  isActive?: boolean | null;
  lowStockOnly?: boolean;
}

export interface ServiceFilterInput {
  search?: string | null;
  categoryId?: ID | null;
  isActive?: boolean | null;
}

export interface ProductInput {
  name: string;
  sku?: string | null;
  barcode?: string | null;
  description?: string | null;
  categoryId?: ID | null;
  price: Money;
  costPrice?: Money | null;
  taxPercentage?: Money | null;
  stockQuantity: Money;
  lowStockThreshold?: Money | null;
  unit: string;
  imageFileIds?: ID[] | null;
  isActive: boolean;
}

export interface ServiceInput {
  name: string;
  code?: string | null;
  description?: string | null;
  categoryId?: ID | null;
  price: Money;
  taxPercentage?: Money | null;
  durationMinutes?: number | null;
  isActive: boolean;
}

export interface CategoryInput {
  name: string;
  description?: string | null;
  color?: string | null;
}

// ---------------------------------------------------------------------------
// Fragments + documents
// ---------------------------------------------------------------------------
const CATEGORY_FIELDS = /* GraphQL */ `
  fragment CategoryFields on CategoryType {
    id
    name
    description
    color
    createdAt
  }
`;

const PRODUCT_FIELDS = /* GraphQL */ `
  ${CATEGORY_FIELDS}
  fragment ProductFields on ProductType {
    id
    name
    sku
    barcode
    description
    categoryId
    category {
      ...CategoryFields
    }
    price
    costPrice
    taxPercentage
    stockQuantity
    lowStockThreshold
    unit
    imageUrls
    isActive
    isLowStock
    createdAt
  }
`;

const SERVICE_FIELDS = /* GraphQL */ `
  ${CATEGORY_FIELDS}
  fragment ServiceFields on ServiceType {
    id
    name
    code
    description
    categoryId
    category {
      ...CategoryFields
    }
    price
    taxPercentage
    durationMinutes
    isActive
    createdAt
  }
`;

const PAGE_INFO = /* GraphQL */ `
  pageInfo {
    total
    page
    limit
    pages
    hasNext
    hasPrevious
  }
`;

export const PRODUCTS_QUERY = /* GraphQL */ `
  ${PRODUCT_FIELDS}
  query Products($filter: ProductFilterInput, $page: PageInput, $sort: SortInput) {
    products(filter: $filter, page: $page, sort: $sort) {
      items {
        ...ProductFields
      }
      ${PAGE_INFO}
    }
  }
`;

export interface ProductsResult {
  products: { items: ProductRecord[]; pageInfo: PageInfo };
}

export const PRODUCT_QUERY = /* GraphQL */ `
  ${PRODUCT_FIELDS}
  query Product($id: ID!) {
    product(id: $id) {
      ...ProductFields
    }
  }
`;

export interface ProductResult {
  product: ProductRecord;
}

export const SERVICES_QUERY = /* GraphQL */ `
  ${SERVICE_FIELDS}
  query Services($filter: ServiceFilterInput, $page: PageInput, $sort: SortInput) {
    services(filter: $filter, page: $page, sort: $sort) {
      items {
        ...ServiceFields
      }
      ${PAGE_INFO}
    }
  }
`;

export interface ServicesResult {
  services: { items: ServiceRecord[]; pageInfo: PageInfo };
}

export const SERVICE_QUERY = /* GraphQL */ `
  ${SERVICE_FIELDS}
  query Service($id: ID!) {
    service(id: $id) {
      ...ServiceFields
    }
  }
`;

export interface ServiceResult {
  service: ServiceRecord;
}

export const CATEGORIES_QUERY = /* GraphQL */ `
  ${CATEGORY_FIELDS}
  query Categories($search: String) {
    categories(search: $search) {
      ...CategoryFields
    }
  }
`;

export interface CategoriesResult {
  categories: CategoryRecord[];
}

export const CREATE_PRODUCT_MUTATION = /* GraphQL */ `
  ${PRODUCT_FIELDS}
  mutation CreateProduct($input: ProductInput!) {
    createProduct(input: $input) {
      ...ProductFields
    }
  }
`;

export interface CreateProductResult {
  createProduct: ProductRecord;
}

export const UPDATE_PRODUCT_MUTATION = /* GraphQL */ `
  ${PRODUCT_FIELDS}
  mutation UpdateProduct($id: ID!, $input: ProductInput!) {
    updateProduct(id: $id, input: $input) {
      ...ProductFields
    }
  }
`;

export interface UpdateProductResult {
  updateProduct: ProductRecord;
}

export const DELETE_PRODUCT_MUTATION = /* GraphQL */ `
  mutation DeleteProduct($id: ID!) {
    deleteProduct(id: $id) {
      id
      name
    }
  }
`;

export interface DeleteProductResult {
  deleteProduct: { id: ID; name: string };
}

/** Stock may go negative on purpose — a stale count must never block a sale. */
export const ADJUST_STOCK_MUTATION = /* GraphQL */ `
  ${PRODUCT_FIELDS}
  mutation AdjustStock($id: ID!, $delta: String!, $reason: String) {
    adjustStock(id: $id, delta: $delta, reason: $reason) {
      ...ProductFields
    }
  }
`;

export interface AdjustStockResult {
  adjustStock: ProductRecord;
}

export const CREATE_SERVICE_MUTATION = /* GraphQL */ `
  ${SERVICE_FIELDS}
  mutation CreateService($input: ServiceInput!) {
    createService(input: $input) {
      ...ServiceFields
    }
  }
`;

export interface CreateServiceResult {
  createService: ServiceRecord;
}

export const UPDATE_SERVICE_MUTATION = /* GraphQL */ `
  ${SERVICE_FIELDS}
  mutation UpdateService($id: ID!, $input: ServiceInput!) {
    updateService(id: $id, input: $input) {
      ...ServiceFields
    }
  }
`;

export interface UpdateServiceResult {
  updateService: ServiceRecord;
}

export const DELETE_SERVICE_MUTATION = /* GraphQL */ `
  mutation DeleteService($id: ID!) {
    deleteService(id: $id) {
      id
      name
    }
  }
`;

export interface DeleteServiceResult {
  deleteService: { id: ID; name: string };
}

export const CREATE_CATEGORY_MUTATION = /* GraphQL */ `
  ${CATEGORY_FIELDS}
  mutation CreateCategory($input: CategoryInput!) {
    createCategory(input: $input) {
      ...CategoryFields
    }
  }
`;

export interface CreateCategoryResult {
  createCategory: CategoryRecord;
}

export const UPDATE_CATEGORY_MUTATION = /* GraphQL */ `
  ${CATEGORY_FIELDS}
  mutation UpdateCategory($id: ID!, $input: CategoryInput!) {
    updateCategory(id: $id, input: $input) {
      ...CategoryFields
    }
  }
`;

export interface UpdateCategoryResult {
  updateCategory: CategoryRecord;
}

/** Members of the category are uncategorised, not deleted. */
export const DELETE_CATEGORY_MUTATION = /* GraphQL */ `
  mutation DeleteCategory($id: ID!) {
    deleteCategory(id: $id) {
      id
      name
    }
  }
`;

export interface DeleteCategoryResult {
  deleteCategory: { id: ID; name: string };
}
