/**
 * Vendor ("supplier") GraphQL documents, types and query keys.
 *
 * Deleting a vendor does NOT blank the expenses paid to them: the name was
 * snapshotted onto each expense when it was recorded, so only the link is removed.
 * See backend/app/models/vendor.py.
 */

import type { ID, ISODateTime } from "@/types";

import type { PageInfo, PageInput, SortInput } from "@/features/credits/queries";

export type { PageInfo, PageInput, SortInput };

export interface VendorRow {
  id: ID;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: ISODateTime;
}

export interface VendorInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean | null;
}

export interface VendorsQueryResult {
  vendors: { items: VendorRow[]; pageInfo: PageInfo };
}

const VENDOR_FIELDS = /* GraphQL */ `
  fragment VendorFields on VendorType {
    id
    name
    phone
    email
    address
    notes
    isActive
    createdAt
  }
`;

export const VENDORS_QUERY = /* GraphQL */ `
  ${VENDOR_FIELDS}
  query Vendors($search: String, $isActive: Boolean, $page: PageInput) {
    vendors(search: $search, isActive: $isActive, page: $page) {
      items {
        ...VendorFields
      }
      pageInfo {
        total
        page
        limit
        pages
        hasNext
        hasPrevious
      }
    }
  }
`;

export const CREATE_VENDOR_MUTATION = /* GraphQL */ `
  ${VENDOR_FIELDS}
  mutation CreateVendor($input: VendorInput!) {
    createVendor(input: $input) {
      ...VendorFields
    }
  }
`;

export const UPDATE_VENDOR_MUTATION = /* GraphQL */ `
  ${VENDOR_FIELDS}
  mutation UpdateVendor($id: ID!, $input: VendorInput!) {
    updateVendor(id: $id, input: $input) {
      ...VendorFields
    }
  }
`;

export const DELETE_VENDOR_MUTATION = /* GraphQL */ `
  mutation DeleteVendor($id: ID!) {
    deleteVendor(id: $id) {
      id
      name
    }
  }
`;

export const vendorKeys = {
  all: ["vendors"] as const,
  lists: () => [...vendorKeys.all, "list"] as const,
  list: (search: string, isActive: boolean | null, page: number) =>
    [...vendorKeys.lists(), { search, isActive, page }] as const,
};
