"use client";

/**
 * Staff accounts: `users`, `createUser`, `updateUser`, `deactivateUser`, `deleteUser`.
 *
 * Two server rules the UI must not contradict (backend/app/services/user.py):
 *   1. Only a SUPER_ADMIN may mint a SUPER_ADMIN.
 *   2. `business_id` is NOT editable — moving a user between businesses is
 *      horizontal privilege escalation, so the field is not in the input at all.
 * `assignableRoles()` below encodes rule 1; rule 2 needs no code, because there is
 * nowhere in this module to express it.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { gqlRequest } from "@/lib/graphql/client";
import type { ID, ISODateTime, Role } from "@/types";

export interface StaffUser {
  id: ID;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  avatarUrl: string | null;
  lastLoginAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface PageInfo {
  total: number;
  page: number;
  limit: number;
  pages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface UserPage {
  items: StaffUser[];
  pageInfo: PageInfo;
}

export interface UserCreateInput {
  email: string;
  fullName: string;
  password: string;
  role: Role;
  phone?: string | null;
}

export interface UserUpdateInput {
  fullName?: string;
  phone?: string | null;
  role?: Role;
  isActive?: boolean;
}

export interface UsersFilter {
  page: number;
  limit: number;
  search?: string;
  role?: Role | "";
  isActive?: boolean;
}

const USER_FIELDS = /* GraphQL */ `
  fragment StaffUserFields on UserType {
    id
    email
    fullName
    phone
    role
    isActive
    avatarUrl
    lastLoginAt
    createdAt
  }
`;

const USERS_QUERY = /* GraphQL */ `
  ${USER_FIELDS}
  query Users($page: PageInput, $search: String, $role: String, $isActive: Boolean) {
    users(page: $page, search: $search, role: $role, isActive: $isActive) {
      items {
        ...StaffUserFields
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

const CREATE_USER_MUTATION = /* GraphQL */ `
  ${USER_FIELDS}
  mutation CreateUser($input: UserCreateInput!) {
    createUser(input: $input) {
      ...StaffUserFields
    }
  }
`;

const UPDATE_USER_MUTATION = /* GraphQL */ `
  ${USER_FIELDS}
  mutation UpdateUser($id: ID!, $input: UserUpdateInput!) {
    updateUser(id: $id, input: $input) {
      ...StaffUserFields
    }
  }
`;

const DEACTIVATE_USER_MUTATION = /* GraphQL */ `
  ${USER_FIELDS}
  mutation DeactivateUser($id: ID!) {
    deactivateUser(id: $id) {
      ...StaffUserFields
    }
  }
`;

const DELETE_USER_MUTATION = /* GraphQL */ `
  mutation DeleteUser($id: ID!) {
    deleteUser(id: $id) {
      id
    }
  }
`;

export const userKeys = {
  all: ["users"] as const,
  list: (filter: UsersFilter) => ["users", "list", filter] as const,
};

export function useUsers(filter: UsersFilter): UseQueryResult<UserPage> {
  return useQuery({
    queryKey: userKeys.list(filter),
    queryFn: async () => {
      const data = await gqlRequest<
        { users: UserPage },
        {
          page: { page: number; limit: number };
          search: string | null;
          role: string | null;
          isActive: boolean | null;
        }
      >(USERS_QUERY, {
        page: { page: filter.page, limit: filter.limit },
        search: filter.search?.trim() ? filter.search.trim() : null,
        role: filter.role ? filter.role : null,
        isActive: filter.isActive ?? null,
      });
      return data.users;
    },
    placeholderData: (previous) => previous, // no table flicker while paging
  });
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: userKeys.all });
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (input: UserCreateInput) => {
      const data = await gqlRequest<{ createUser: StaffUser }, { input: UserCreateInput }>(
        CREATE_USER_MUTATION,
        { input },
      );
      return data.createUser;
    },
    onSuccess: () => void invalidate(),
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async ({ id, input }: { id: ID; input: UserUpdateInput }) => {
      const data = await gqlRequest<
        { updateUser: StaffUser },
        { id: ID; input: UserUpdateInput }
      >(UPDATE_USER_MUTATION, { id, input });
      return data.updateUser;
    },
    onSuccess: () => void invalidate(),
  });
}

export function useDeactivateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (id: ID) => {
      const data = await gqlRequest<{ deactivateUser: StaffUser }, { id: ID }>(
        DEACTIVATE_USER_MUTATION,
        { id },
      );
      return data.deactivateUser;
    },
    onSuccess: () => void invalidate(),
  });
}

export function useDeleteUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (id: ID) => {
      await gqlRequest<{ deleteUser: { id: ID } }, { id: ID }>(DELETE_USER_MUTATION, { id });
      return id;
    },
    onSuccess: () => void invalidate(),
  });
}

/**
 * Which roles the signed-in user may assign.
 *
 * An ADMIN offering "Super admin" in a dropdown would be offering an option the
 * server refuses — a button that only ever produces an error is worse than no
 * button. The server is still the authority; this just keeps the UI honest.
 */
export function assignableRoles(actorRole: Role | undefined): Role[] {
  if (actorRole === "SUPER_ADMIN") return ["SUPER_ADMIN", "ADMIN", "STAFF"];
  if (actorRole === "ADMIN") return ["ADMIN", "STAFF"];
  return [];
}
