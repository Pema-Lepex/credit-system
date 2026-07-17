"""Domain enumerations.

Stored as strings, not integers: a human reading the SQLite file (or a CSV export)
should see ``PARTIALLY_PAID``, not ``2``. Costs a few bytes per row, saves hours of
debugging and makes exports self-describing.
"""

from __future__ import annotations

from enum import Enum


class CreditStatus(str, Enum):
    """Lifecycle of a credit record.

    OVERDUE is *derived*, not hand-set: the daily scheduler promotes PENDING and
    PARTIALLY_PAID records past their due date. Keeping it as a stored column (as
    opposed to computing it in every query) is what lets the dashboard filter and
    index on it cheaply.
    """

    PENDING = "PENDING"
    PARTIALLY_PAID = "PARTIALLY_PAID"
    PAID = "PAID"
    OVERDUE = "OVERDUE"
    CANCELLED = "CANCELLED"

    @classmethod
    def open_statuses(cls) -> tuple[CreditStatus, ...]:
        """Statuses that still owe money -- i.e. count toward receivables."""
        return (cls.PENDING, cls.PARTIALLY_PAID, cls.OVERDUE)

    @classmethod
    def closed_statuses(cls) -> tuple[CreditStatus, ...]:
        """Terminal statuses -- eligible for archival under the retention policy."""
        return (cls.PAID, cls.CANCELLED)


class ApprovalStatus(str, Enum):
    """Platform-level approval state of a Business (tenant).

    Lives on the Business, not the User, on purpose: a store owner and every staff
    account they create share one tenant, and approval must gate the whole shop
    together. Putting it on the User would leave staff ungated (they have their own
    User row) unless every check re-resolved the owner's status -- more code for the
    same result. See the super-admin panel and BaseService's tenant gate.

        PENDING   -> just registered; can sign in ONLY to see this status.
        APPROVED  -> full access to the application.
        REJECTED  -> can sign in, sees the rejection reason, nothing else works.
        SUSPENDED -> was approved, access revoked; sees the reason, nothing works.

    Only APPROVED unlocks the business modules; the other three all resolve to HTTP
    403 on every protected API.
    """

    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    SUSPENDED = "SUSPENDED"

    @classmethod
    def usable_statuses(cls) -> tuple[ApprovalStatus, ...]:
        """Statuses under which a tenant may use the application. Just one."""
        return (cls.APPROVED,)


class CustomerStatus(str, Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    BLOCKED = "BLOCKED"      # owner has cut off further credit
    DEFAULTED = "DEFAULTED"  # written off


class PaymentMethod(str, Enum):
    CASH = "CASH"
    BANK_TRANSFER = "BANK_TRANSFER"
    CARD = "CARD"
    MOBILE_MONEY = "MOBILE_MONEY"
    CHEQUE = "CHEQUE"
    OTHER = "OTHER"


class ItemKind(str, Enum):
    PRODUCT = "PRODUCT"
    SERVICE = "SERVICE"
    CUSTOM = "CUSTOM"  # free-text line item not in the catalog


class ReminderChannel(str, Enum):
    """SMS/WHATSAPP are declared now and dispatch through the same provider
    interface as EMAIL. Adding them later is a new provider class, not a schema
    change -- which is exactly what "future-ready" has to mean to be worth
    anything."""

    EMAIL = "EMAIL"
    SMS = "SMS"
    WHATSAPP = "WHATSAPP"
    IN_APP = "IN_APP"


class ReminderAudience(str, Enum):
    CUSTOMER = "CUSTOMER"
    OWNER = "OWNER"
    BOTH = "BOTH"


class ReminderStatus(str, Enum):
    SCHEDULED = "SCHEDULED"
    SENT = "SENT"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"    # e.g. credit was paid before the reminder fired
    CANCELLED = "CANCELLED"


class EmailTemplateKind(str, Enum):
    """The owner-editable message templates.

    The WHATSAPP_* kinds are not email, despite the enum's name -- they are carried
    by app/services/whatsapp.py into a click-to-chat link. They live here anyway,
    and that is deliberate: it means a shop owner edits their WhatsApp wording in
    the same admin screen, with the same {{variables}}, as everything else. The
    alternative -- a second, parallel template system for one channel -- buys
    nothing but a second place for the copy to rot.

    They are separate kinds rather than a reuse of REMINDER because the email copy
    says "reply to this email" and runs to several paragraphs: right in an inbox,
    wrong in a chat window.
    """

    REMINDER = "REMINDER"
    RECEIPT = "RECEIPT"
    PAYMENT_CONFIRMATION = "PAYMENT_CONFIRMATION"
    WELCOME = "WELCOME"
    ADMIN_NOTIFICATION = "ADMIN_NOTIFICATION"
    OVERDUE_NOTICE = "OVERDUE_NOTICE"
    DATA_DELETION_WARNING = "DATA_DELETION_WARNING"
    WHATSAPP_REMINDER = "WHATSAPP_REMINDER"
    WHATSAPP_OVERDUE = "WHATSAPP_OVERDUE"


class LedgerEntryType(str, Enum):
    """Every way a customer's balance can move.

    THE SIGN CONVENTION, fixed once and enforced by LedgerService:
    a POSITIVE amount increases what the customer owes; a NEGATIVE amount reduces
    it. There are no debit/credit columns -- one signed integer makes the balance a
    plain SUM(), makes a reversal a negation, and removes the whole class of bug
    where a row has both columns populated.

    A negative balance is legal and meaningful: the shop is holding an advance.
    """

    #: Carried forward -- from paper, or from a period that has been archived away.
    OPENING_BALANCE = "OPENING_BALANCE"
    #: They took goods. Posted by a sale (today: by a Credit).
    CHARGE = "CHARGE"
    #: They paid. Posted by a payment, against the ACCOUNT -- never against one charge.
    PAYMENT = "PAYMENT"
    #: A correction, a discount, a returned item.
    ADJUSTMENT = "ADJUSTMENT"
    #: Debt forgiven or abandoned. A decision, recorded rather than deleted.
    WRITE_OFF = "WRITE_OFF"
    #: Cancels an earlier entry. The ONLY way to undo one -- see models/ledger.py.
    REVERSAL = "REVERSAL"

    @classmethod
    def increases_debt(cls) -> frozenset["LedgerEntryType"]:
        """Types whose amount must be >= 0. ADJUSTMENT/REVERSAL/OPENING_BALANCE may
        go either way, so they are in neither set."""
        return frozenset({cls.CHARGE})

    @classmethod
    def reduces_debt(cls) -> frozenset["LedgerEntryType"]:
        """Types whose amount must be <= 0."""
        return frozenset({cls.PAYMENT, cls.WRITE_OFF})


class NotificationKind(str, Enum):
    EMAIL_SENT = "EMAIL_SENT"
    REMINDER_SENT = "REMINDER_SENT"
    PAYMENT_RECEIVED = "PAYMENT_RECEIVED"
    CREDIT_OVERDUE = "CREDIT_OVERDUE"
    DATA_DELETION_WARNING = "DATA_DELETION_WARNING"
    EXPORT_READY = "EXPORT_READY"
    STORAGE_WARNING = "STORAGE_WARNING"
    SYSTEM = "SYSTEM"


class NotificationState(str, Enum):
    UNREAD = "UNREAD"
    READ = "READ"
    ARCHIVED = "ARCHIVED"


class FileKind(str, Enum):
    """Doubles as the uploads/ subfolder name -- see StorageService."""

    BUSINESS_LOGO = "BUSINESS_LOGO"
    USER_AVATAR = "USER_AVATAR"
    CUSTOMER_PHOTO = "CUSTOMER_PHOTO"
    PRODUCT_IMAGE = "PRODUCT_IMAGE"
    INVOICE = "INVOICE"
    RECEIPT = "RECEIPT"
    CREDIT_PHOTO = "CREDIT_PHOTO"
    EXPORT = "EXPORT"
    TEMP = "TEMP"


class RetentionPolicy(str, Enum):
    DAYS_30 = "DAYS_30"
    DAYS_60 = "DAYS_60"
    DAYS_90 = "DAYS_90"
    NEVER = "NEVER"

    @property
    def days(self) -> int | None:
        """``None`` means "never delete"."""
        return {
            RetentionPolicy.DAYS_30: 30,
            RetentionPolicy.DAYS_60: 60,
            RetentionPolicy.DAYS_90: 90,
            RetentionPolicy.NEVER: None,
        }[self]


class ArchiveState(str, Enum):
    """The deletion pipeline. Data is never destroyed in one step.

    ARCHIVED -> (7/3/1-day warnings) -> PENDING_DELETION -> DELETED
    The owner can POSTPONE from any pre-DELETED state, or RESTORE the records.
    """

    ARCHIVED = "ARCHIVED"
    PENDING_DELETION = "PENDING_DELETION"
    POSTPONED = "POSTPONED"
    RESTORED = "RESTORED"
    DELETED = "DELETED"


class ExportFormat(str, Enum):
    CSV = "CSV"
    XLSX = "XLSX"
    JSON = "JSON"
    PDF = "PDF"


class ExportState(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    READY = "READY"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"   # file removed by the daily cleanup job after EXPORT_TTL_HOURS


class ReportPeriod(str, Enum):
    DAILY = "DAILY"
    WEEKLY = "WEEKLY"
    MONTHLY = "MONTHLY"
    YEARLY = "YEARLY"
    CUSTOM = "CUSTOM"


class AuditAction(str, Enum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"          # soft delete
    PURGE = "PURGE"            # irreversible -- always audited (spec requirement)
    LOGIN = "LOGIN"
    LOGIN_FAILED = "LOGIN_FAILED"
    LOGOUT = "LOGOUT"
    PASSWORD_RESET = "PASSWORD_RESET"
    EXPORT = "EXPORT"
    ARCHIVE = "ARCHIVE"
    RESTORE = "RESTORE"
    MAINTENANCE = "MAINTENANCE"
    REMINDER = "REMINDER"
