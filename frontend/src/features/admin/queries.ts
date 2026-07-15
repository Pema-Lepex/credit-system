/**
 * Super Admin GraphQL documents.
 *
 * These target the admin half of the schema (queries.py / mutations.py). Every one
 * is SUPER_ADMIN-only on the server; the UI simply never renders for anyone else.
 * Keep these in step with `docs/schema.graphql`.
 */

export const ADMIN_BUSINESS_FIELDS = /* GraphQL */ `
  fragment AdminBusinessFields on AdminBusinessType {
    id
    name
    slug
    description
    email
    phone
    address
    city
    country
    approvalStatus
    approvalReason
    approvedAt
    isActive
    createdAt
    ownerName
    ownerEmail
    ownerPhone
    ownerLastLoginAt
    userCount
    customerCount
    creditCount
  }
`;

export const ADMIN_STATS_QUERY = /* GraphQL */ `
  query AdminStats {
    adminStats {
      totalStoreOwners
      pending
      approved
      rejected
      suspended
    }
  }
`;

export const ADMIN_BUSINESSES_QUERY = /* GraphQL */ `
  ${ADMIN_BUSINESS_FIELDS}
  query AdminBusinesses($page: PageInput, $status: ApprovalStatus, $search: String) {
    adminBusinesses(page: $page, status: $status, search: $search) {
      items {
        ...AdminBusinessFields
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

export const ADMIN_BUSINESS_QUERY = /* GraphQL */ `
  ${ADMIN_BUSINESS_FIELDS}
  query AdminBusiness($id: ID!) {
    adminBusiness(id: $id) {
      ...AdminBusinessFields
    }
  }
`;

export const APPROVE_BUSINESS_MUTATION = /* GraphQL */ `
  ${ADMIN_BUSINESS_FIELDS}
  mutation ApproveBusiness($id: ID!) {
    approveBusiness(id: $id) {
      ...AdminBusinessFields
    }
  }
`;

export const REJECT_BUSINESS_MUTATION = /* GraphQL */ `
  ${ADMIN_BUSINESS_FIELDS}
  mutation RejectBusiness($id: ID!, $reason: String!) {
    rejectBusiness(id: $id, reason: $reason) {
      ...AdminBusinessFields
    }
  }
`;

export const SUSPEND_BUSINESS_MUTATION = /* GraphQL */ `
  ${ADMIN_BUSINESS_FIELDS}
  mutation SuspendBusiness($id: ID!, $reason: String!) {
    suspendBusiness(id: $id, reason: $reason) {
      ...AdminBusinessFields
    }
  }
`;

export const ACTIVATE_BUSINESS_MUTATION = /* GraphQL */ `
  ${ADMIN_BUSINESS_FIELDS}
  mutation ActivateBusiness($id: ID!) {
    activateBusiness(id: $id) {
      ...AdminBusinessFields
    }
  }
`;

export const DELETE_BUSINESS_MUTATION = /* GraphQL */ `
  mutation DeleteBusiness($id: ID!) {
    deleteBusiness(id: $id) {
      success
      message
    }
  }
`;
