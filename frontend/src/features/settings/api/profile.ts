"use client";

/**
 * `updateProfile` + `changePassword`.
 *
 * Both mutations return the fresh UserType, so on success we push it straight
 * into AuthProvider via `refreshUser()` — otherwise the topbar keeps showing the
 * old name and avatar until a reload.
 */

import { useMutation } from "@tanstack/react-query";

import { gqlRequest } from "@/lib/graphql/client";
import type { ID, ISODateTime, Role } from "@/types";

export interface ProfileUpdateInput {
  fullName?: string;
  phone?: string | null;
  avatarFileId?: ID | null;
  theme?: string;
  language?: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

interface ProfileUser {
  id: ID;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  avatarUrl: string | null;
  theme: string;
  language: string;
  lastLoginAt: ISODateTime | null;
}

const PROFILE_FIELDS = /* GraphQL */ `
  fragment ProfileFields on UserType {
    id
    email
    fullName
    phone
    role
    avatarUrl
    theme
    language
    lastLoginAt
  }
`;

const UPDATE_PROFILE_MUTATION = /* GraphQL */ `
  ${PROFILE_FIELDS}
  mutation UpdateProfile($input: ProfileUpdateInput!) {
    updateProfile(input: $input) {
      ...ProfileFields
    }
  }
`;

const CHANGE_PASSWORD_MUTATION = /* GraphQL */ `
  ${PROFILE_FIELDS}
  mutation ChangePassword($input: ChangePasswordInput!) {
    changePassword(input: $input) {
      ...ProfileFields
    }
  }
`;

export function useUpdateProfile() {
  return useMutation({
    mutationFn: async (input: ProfileUpdateInput) => {
      const data = await gqlRequest<
        { updateProfile: ProfileUser },
        { input: ProfileUpdateInput }
      >(UPDATE_PROFILE_MUTATION, { input });
      return data.updateProfile;
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: ChangePasswordInput) => {
      const data = await gqlRequest<
        { changePassword: ProfileUser },
        { input: ChangePasswordInput }
      >(CHANGE_PASSWORD_MUTATION, { input });
      return data.changePassword;
    },
  });
}
