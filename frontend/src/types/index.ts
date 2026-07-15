/**
 * Domain types — hand-written mirror of the backend SQLModel/Strawberry schema.
 *
 * WHY HAND-WRITTEN: the GraphQL schema is not published yet, so codegen has
 * nothing to read. These are the contract every feature agent shares. The string
 * values are copied verbatim from `backend/app/models/enums.py` and
 * `backend/app/core/security.py` — if the backend changes an enum value, change
 * it here, not in a component.
 *
 * NAMING: fields are camelCase because Strawberry auto-camel-cases Python
 * snake_case field names on the way out (`business_id` -> `businessId`).
 *
 * MONEY: Python `Decimal` is serialised by Strawberry as a *String* scalar, not a
 * float — deliberately, so 0.1 + 0.2 never becomes 0.30000000000000004 in
 * transit. Hence `Money = string`. Convert at the edge (formatCurrency takes
 * either), never accumulate money in a JS number.
 */

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------
/** Decimal serialised as a string, e.g. "1250.00". */
export type Money = string;
/** ISO-8601 date, e.g. "2026-07-14". */
export type ISODate = string;
/** ISO-8601 datetime with offset, e.g. "2026-07-14T09:30:00+00:00". */
export type ISODateTime = string;
/** 32-char uuid4 hex (no dashes) — see backend models/base.py `new_id()`. */
export type ID = string;

// ---------------------------------------------------------------------------
// Auth — backend/app/core/security.py
// ---------------------------------------------------------------------------
export const ROLES = ["SUPER_ADMIN", "ADMIN", "STAFF"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "business:read",
  "business:update",
  "business:create",
  "business:delete",
  "user:read",
  "user:manage",
  "customer:read",
  "customer:write",
  "customer:delete",
  "catalog:read",
  "catalog:write",
  "catalog:delete",
  "credit:read",
  "credit:write",
  "credit:delete",
  "payment:read",
  "payment:write",
  "payment:delete",
  "report:read",
  "export:create",
  "settings:read",
  "settings:write",
  "template:write",
  "reminder:send",
  "storage:read",
  "storage:maintain",
  "retention:manage",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// ---------------------------------------------------------------------------
// Domain enums — backend/app/models/enums.py
// ---------------------------------------------------------------------------
export const CREDIT_STATUSES = [
  "PENDING",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "CANCELLED",
] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];

/** Statuses that still owe money — mirrors `CreditStatus.open_statuses()`. */
export const OPEN_CREDIT_STATUSES: readonly CreditStatus[] = [
  "PENDING",
  "PARTIALLY_PAID",
  "OVERDUE",
];
/** Terminal statuses, eligible for archival — mirrors `closed_statuses()`. */
export const CLOSED_CREDIT_STATUSES: readonly CreditStatus[] = ["PAID", "CANCELLED"];

export const CUSTOMER_STATUSES = ["ACTIVE", "INACTIVE", "BLOCKED", "DEFAULTED"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/**
 * Platform approval state of a Business (tenant) — mirrors
 * `backend/app/models/enums.py::ApprovalStatus`. Lives on the business, but is
 * surfaced on the signed-in user (see `User.approvalStatus`) so the app can gate
 * off `me`. Only APPROVED unlocks the business modules.
 */
export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const PAYMENT_METHODS = [
  "CASH",
  "BANK_TRANSFER",
  "CARD",
  "MOBILE_MONEY",
  "CHEQUE",
  "OTHER",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ITEM_KINDS = ["PRODUCT", "SERVICE", "CUSTOM"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const REMINDER_CHANNELS = ["EMAIL", "SMS", "WHATSAPP", "IN_APP"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export const REMINDER_AUDIENCES = ["CUSTOMER", "OWNER", "BOTH"] as const;
export type ReminderAudience = (typeof REMINDER_AUDIENCES)[number];

export const REMINDER_STATUSES = [
  "SCHEDULED",
  "SENT",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const EMAIL_TEMPLATE_KINDS = [
  "REMINDER",
  "RECEIPT",
  "PAYMENT_CONFIRMATION",
  "WELCOME",
  "ADMIN_NOTIFICATION",
  "OVERDUE_NOTICE",
  "DATA_DELETION_WARNING",
] as const;
export type EmailTemplateKind = (typeof EMAIL_TEMPLATE_KINDS)[number];

export const NOTIFICATION_KINDS = [
  "EMAIL_SENT",
  "REMINDER_SENT",
  "PAYMENT_RECEIVED",
  "CREDIT_OVERDUE",
  "DATA_DELETION_WARNING",
  "EXPORT_READY",
  "STORAGE_WARNING",
  "SYSTEM",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_STATES = ["UNREAD", "READ", "ARCHIVED"] as const;
export type NotificationState = (typeof NOTIFICATION_STATES)[number];

export const FILE_KINDS = [
  "BUSINESS_LOGO",
  "USER_AVATAR",
  "CUSTOMER_PHOTO",
  "PRODUCT_IMAGE",
  "INVOICE",
  "RECEIPT",
  "CREDIT_PHOTO",
  "EXPORT",
  "TEMP",
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const RETENTION_POLICIES = ["DAYS_30", "DAYS_60", "DAYS_90", "NEVER"] as const;
export type RetentionPolicy = (typeof RETENTION_POLICIES)[number];

/** `null` = never delete. Mirrors `RetentionPolicy.days`. */
export const RETENTION_POLICY_DAYS: Record<RetentionPolicy, number | null> = {
  DAYS_30: 30,
  DAYS_60: 60,
  DAYS_90: 90,
  NEVER: null,
};

export const ARCHIVE_STATES = [
  "ARCHIVED",
  "PENDING_DELETION",
  "POSTPONED",
  "RESTORED",
  "DELETED",
] as const;
export type ArchiveState = (typeof ARCHIVE_STATES)[number];

export const EXPORT_FORMATS = ["CSV", "XLSX", "JSON", "PDF"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_STATES = ["PENDING", "RUNNING", "READY", "FAILED", "EXPIRED"] as const;
export type ExportState = (typeof EXPORT_STATES)[number];

export const REPORT_PERIODS = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "CUSTOM"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const AUDIT_ACTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "PURGE",
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "PASSWORD_RESET",
  "EXPORT",
  "ARCHIVE",
  "RESTORE",
  "MAINTENANCE",
  "REMINDER",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
/** Fields every persisted row carries (models/base.py BaseEntity). */
export interface BaseEntity {
  id: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime | null;
}

export interface User extends BaseEntity {
  email: string;
  fullName: string;
  phone?: string | null;
  avatarFileId?: ID | null;
  avatarUrl?: string | null;
  role: Role;
  /** null only for SUPER_ADMIN, who operates above any single business. */
  businessId?: ID | null;
  business?: Business | null;
  isActive: boolean;
  lastLoginAt?: ISODateTime | null;
  theme: "light" | "dark" | "system";
  language: string;
  /** Resolved server-side from ROLE_PERMISSIONS; never trust a client-side derivation. */
  permissions?: Permission[];
  /**
   * The approval state of this user's business, resolved server-side. APPROVED for a
   * SUPER_ADMIN (no tenant). The app gates every business module on this being
   * APPROVED — see the account-status screen. The server enforces it regardless.
   */
  approvalStatus?: ApprovalStatus;
  /** Why the account was rejected/suspended — shown to the owner. Null otherwise. */
  approvalReason?: string | null;
}

export interface WorkingHoursDay {
  open: string; // "09:00"
  close: string; // "18:00"
  closed: boolean;
}
export type WorkingHours = Partial<
  Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", WorkingHoursDay>
>;

export interface Business extends BaseEntity {
  name: string;
  slug: string;
  description?: string | null;
  logoFileId?: ID | null;
  logoUrl?: string | null;

  email?: string | null;
  phone?: string | null;
  whatsappNumber?: string | null;
  website?: string | null;

  facebookUrl?: string | null;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;

  address?: string | null;
  city?: string | null;
  country?: string | null;
  googleMapsUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;

  currency: string; // ISO-4217
  currencySymbol: string;
  timezone: string; // IANA
  locale: string;
  taxPercentage: Money;
  workingHours: WorkingHours;

  remindersEnabled: boolean;
  reminderDaysBefore: number[];
  reminderAudience: ReminderAudience;
  reminderSendHour: number;
  notifyOwnerOnOverdue: boolean;
  notifyOwnerOnPayment: boolean;

  emailFromName?: string | null;
  emailReplyTo?: string | null;
  emailSignature?: string | null;
  brandColor: string;

  retentionPolicy: RetentionPolicy;
  retentionNotificationsEnabled: boolean;
  storageQuotaMb: number;

  isActive: boolean;
}

export interface Customer extends BaseEntity {
  businessId: ID;
  /** Human-facing code, unique per business, e.g. CUST-0007. */
  code: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;

  photoFileId?: ID | null;
  photoUrl?: string | null;
  notes?: string | null;

  status: CustomerStatus;

  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;

  /** Internal 0-100 heuristic, NOT a bureau score. */
  creditScore: number;
  creditLimit?: Money | null;

  // Cached aggregates — derived, recomputed on every credit/payment write.
  totalCredit: Money;
  totalPaid: Money;
  outstandingBalance: Money;
  creditCount: number;
  overdueCount: number;
  lastCreditAt?: ISODateTime | null;
  lastPaymentAt?: ISODateTime | null;

  dateOfBirth?: ISODate | null;
}

export interface Category extends BaseEntity {
  businessId: ID;
  name: string;
  description?: string | null;
  color?: string | null;
}

export interface Product extends BaseEntity {
  businessId: ID;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  description?: string | null;
  categoryId?: ID | null;
  category?: Category | null;
  price: Money;
  costPrice?: Money | null;
  taxPercentage?: Money | null;
  /** Tracked but never enforced — this is a credit tracker, not inventory software. */
  stockQuantity: Money;
  lowStockThreshold?: Money | null;
  unit: string;
  imageFileIds: ID[];
  imageUrls?: string[];
  isActive: boolean;
}

export interface Service extends BaseEntity {
  businessId: ID;
  name: string;
  code?: string | null;
  description?: string | null;
  categoryId?: ID | null;
  category?: Category | null;
  price: Money;
  taxPercentage?: Money | null;
  durationMinutes?: number | null;
  isActive: boolean;
}

export interface CreditItem extends BaseEntity {
  businessId: ID;
  creditId: ID;
  kind: ItemKind;
  productId?: ID | null;
  serviceId?: ID | null;
  /** Snapshot of the catalog name/price AT SALE TIME — intentionally not a join. */
  name: string;
  description?: string | null;
  unit: string;
  quantity: Money;
  unitPrice: Money;
  discountAmount: Money;
  taxPercentage: Money;
  taxAmount: Money;
  lineSubtotal: Money;
  lineTotal: Money;
  position: number;
}

export interface Credit extends BaseEntity {
  businessId: ID;
  /** Human-facing number, unique per business, e.g. CR-2026-0042. */
  number: string;
  customerId: ID;
  customer?: Customer | null;

  subtotal: Money;
  discountAmount: Money;
  taxAmount: Money;
  grandTotal: Money;
  /** Derived from the payment ledger — never edit directly. */
  amountPaid: Money;
  /** grandTotal - amountPaid. Never edit directly. */
  remainingAmount: Money;

  discountPercentage?: Money | null;
  taxPercentage?: Money | null;
  currency: string;

  issuedDate: ISODate;
  dueDate: ISODate;
  reminderDate?: ISODate | null;
  paidAt?: ISODateTime | null;

  status: CreditStatus;
  notes?: string | null;

  photoFileIds: ID[];
  invoiceFileId?: ID | null;

  createdByUserId?: ID | null;
  archivedAt?: ISODateTime | null;
  archiveBatchId?: ID | null;

  items?: CreditItem[];
  payments?: Payment[];
}

export interface Payment extends BaseEntity {
  businessId: ID;
  /** e.g. PAY-2026-0117 */
  number: string;
  creditId: ID;
  credit?: Credit | null;
  customerId: ID;
  customer?: Customer | null;

  amount: Money;
  /** Running balance at the moment of payment — preserved even if an earlier
   *  payment is later voided, so the receipt stays truthful. */
  balanceAfter: Money;

  method: PaymentMethod;
  reference?: string | null;
  notes?: string | null;
  paidAt: ISODateTime;

  receiptFileId?: ID | null;
  receivedByUserId?: ID | null;

  /** Payments are append-only: corrections void and re-record, never edit. */
  voidedAt?: ISODateTime | null;
  voidReason?: string | null;

  archivedAt?: ISODateTime | null;
  archiveBatchId?: ID | null;
}

/** Deep-link payload on a notification: {"type":"credit","id":"..."} -> /credits/:id */
export interface NotificationLink {
  type?: string;
  id?: string;
  url?: string;
}

export interface Notification extends BaseEntity {
  businessId: ID;
  kind: NotificationKind;
  state: NotificationState;
  title: string;
  message: string;
  link: NotificationLink;
  meta: Record<string, unknown>;
  /** null = broadcast to the whole business. */
  userId?: ID | null;
  readAt?: ISODateTime | null;
  archivedAt?: ISODateTime | null;
}

export interface FileAsset extends BaseEntity {
  businessId: ID;
  kind: FileKind;
  originalFilename: string;
  storageKey: string;
  thumbnailKey?: string | null;
  url?: string | null;
  thumbnailUrl?: string | null;
  contentType: string;
  sizeBytes: number;
  originalSizeBytes: number;
  /** sha256 of the stored bytes — the dedup key, unique per business. */
  checksum: string;
  width?: number | null;
  height?: number | null;
  referenceCount: number;
  orphanedAt?: ISODateTime | null;
  expiresAt?: ISODateTime | null;
  uploadedByUserId?: ID | null;
}

export interface EmailTemplate extends BaseEntity {
  businessId: ID;
  kind: EmailTemplateKind;
  name: string;
  subject: string;
  bodyHtml: string;
  footerHtml?: string | null;
  signature?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  logoFileId?: ID | null;
  showLogo: boolean;
  isActive: boolean;
  /** Flips to false once the owner edits the seeded default. */
  isDefault: boolean;
}

export interface ScheduledReminder extends BaseEntity {
  businessId: ID;
  creditId: ID;
  customerId: ID;
  audience: ReminderAudience;
  channel: ReminderChannel;
  scheduledFor: ISODate;
  /** 0 = on the due date; negative = overdue chase. */
  daysBeforeDue: number;
  status: ReminderStatus;
  sentAt?: ISODateTime | null;
  attempts: number;
  lastError?: string | null;
}

// ---------------------------------------------------------------------------
// Transport shapes
// ---------------------------------------------------------------------------
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType?: string;
  expiresIn?: number;
}

export interface AuthPayload extends AuthTokens {
  user: User;
}

/** Relay-ish page envelope. Kept generic; feature agents narrow `items`. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

export type SortDirection = "asc" | "desc";

// ---------------------------------------------------------------------------
// Super Admin panel — mirrors AdminBusinessType / AdminStats in the backend schema.
// ---------------------------------------------------------------------------
export interface AdminBusiness {
  id: ID;
  name: string;
  slug: string;
  description?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;

  approvalStatus: ApprovalStatus;
  approvalReason?: string | null;
  approvedAt?: ISODateTime | null;
  isActive: boolean;
  createdAt: ISODateTime;

  ownerName?: string | null;
  ownerEmail?: string | null;
  ownerPhone?: string | null;
  ownerLastLoginAt?: ISODateTime | null;

  /** Populated on the detail view only; null in list rows. */
  userCount?: number | null;
  customerCount?: number | null;
  creditCount?: number | null;
}

export interface AdminStats {
  totalStoreOwners: number;
  pending: number;
  approved: number;
  rejected: number;
  suspended: number;
}

/** Platform (super-admin) settings. The W3Forms key is write-only — the API only
 *  ever returns whether it is set and a masked tail. */
export interface PlatformSettings {
  hasW3formsAccessKey: boolean;
  w3formsAccessKeyHint?: string | null;
}
