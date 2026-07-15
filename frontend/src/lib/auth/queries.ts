/**
 * Auth GraphQL documents.
 *
 * These are validated against the real schema (`docs/schema.graphql`) — not guessed.
 * Two things about it are easy to get wrong, so they are called out here:
 *
 *   1. The auth mutations take a single `input:` object (`LoginInput!`,
 *      `RegisterInput!`, `ResetPasswordInput!`), NOT loose scalar arguments.
 *   2. `logout`, `requestPasswordReset` and `resetPassword` return `MessagePayload!`
 *      — an object — so they MUST select `{ success message }`. A bare
 *      `logout(...)` is a schema error, not a shortcut.
 *
 * The user type is `UserType`, and it has no `business` sub-selection: the business
 * is fetched separately by the `business` query. Keep this file in step with the
 * schema; it is the only place these documents live.
 */

const USER_FIELDS = /* GraphQL */ `
  fragment UserFields on UserType {
    id
    email
    fullName
    phone
    role
    businessId
    isActive
    theme
    language
    permissions
    avatarUrl
    lastLoginAt
    createdAt
    approvalStatus
    approvalReason
  }
`;

export const ME_QUERY = /* GraphQL */ `
  ${USER_FIELDS}
  query Me {
    me {
      ...UserFields
    }
  }
`;

export const LOGIN_MUTATION = /* GraphQL */ `
  ${USER_FIELDS}
  mutation Login($email: String!, $password: String!) {
    login(input: { email: $email, password: $password }) {
      accessToken
      refreshToken
      user {
        ...UserFields
      }
    }
  }
`;

export const REGISTER_MUTATION = /* GraphQL */ `
  ${USER_FIELDS}
  mutation Register(
    $email: String!
    $password: String!
    $fullName: String!
    $businessName: String!
  ) {
    register(
      input: {
        email: $email
        password: $password
        fullName: $fullName
        businessName: $businessName
      }
    ) {
      accessToken
      refreshToken
      user {
        ...UserFields
      }
    }
  }
`;

// Public, unauthenticated. Returns the W3Forms access key the browser uses to email
// the super-admin about a new signup (see lib/auth/registration-notice.ts for why
// the notice is sent client-side). Null when no key is configured.
export const REGISTRATION_NOTICE_KEY_QUERY = /* GraphQL */ `
  query RegistrationNoticeKey {
    registrationNoticeKey
  }
`;

// NOTE: the refresh mutation deliberately lives in `lib/graphql/client.ts`, not here.
// The client owns the refresh loop (one shared in-flight promise for N waiters), and
// it must not import from the auth layer that imports from it.

export const LOGOUT_MUTATION = /* GraphQL */ `
  mutation Logout($refreshToken: String!) {
    logout(refreshToken: $refreshToken) {
      success
      message
    }
  }
`;

export const FORGOT_PASSWORD_MUTATION = /* GraphQL */ `
  mutation RequestPasswordReset($email: String!) {
    requestPasswordReset(email: $email) {
      success
      message
    }
  }
`;

export const RESET_PASSWORD_MUTATION = /* GraphQL */ `
  mutation ResetPassword($token: String!, $newPassword: String!) {
    resetPassword(input: { token: $token, newPassword: $newPassword }) {
      success
      message
    }
  }
`;
