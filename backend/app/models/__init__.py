"""SQLModel entities.

Importing this package registers every table on ``SQLModel.metadata``, which is
what ``init_db()`` and Alembic's autogenerate rely on. Add new models to the
imports below or they will silently not exist.
"""

from __future__ import annotations

from app.models.base import BaseEntity, TenantEntity, new_id, utcnow
from app.models.business import Business
from app.models.catalog import Category, Product, Service
from app.models.communication import (
    EmailLog,
    EmailTemplate,
    Notification,
    ScheduledReminder,
)
from app.models.credit import Credit, CreditItem, Payment
from app.models.customer import Customer
from app.models.cash_account import CashAccount
from app.models.expense import Expense, ExpenseCategory
from app.models.recurring import RecurringExpenseTemplate
from app.models.vendor import Vendor
from app.models.enums import (
    ArchiveState,
    AuditAction,
    CreditStatus,
    CustomerStatus,
    EmailTemplateKind,
    ExpenseFrequency,
    ExportFormat,
    ExportState,
    FileKind,
    ItemKind,
    LedgerEntryType,
    StatementStatus,
    NotificationKind,
    NotificationState,
    PaymentMethod,
    ReminderAudience,
    ReminderChannel,
    ReminderStatus,
    ReportPeriod,
    RetentionPolicy,
)
from app.models.file import FileAsset
from app.models.ledger import LedgerEntry
from app.models.platform import PlatformSetting
from app.models.statement import Statement
from app.models.retention import ArchiveBatch, AuditLog, ExportJob
from app.models.stored_blob import StoredBlob
from app.models.types import MoneyType, quantize_money
from app.models.user import PasswordResetToken, RefreshToken, User

__all__ = [
    # base
    "BaseEntity",
    "TenantEntity",
    "new_id",
    "utcnow",
    "MoneyType",
    "quantize_money",
    # entities
    "ArchiveBatch",
    "AuditLog",
    "Business",
    "CashAccount",
    "Category",
    "Credit",
    "CreditItem",
    "Customer",
    "EmailLog",
    "EmailTemplate",
    "Expense",
    "ExpenseCategory",
    "ExportJob",
    "FileAsset",
    "LedgerEntry",
    "LedgerEntryType",
    "Notification",
    "PasswordResetToken",
    "Payment",
    "PlatformSetting",
    "Statement",
    "StatementStatus",
    "Product",
    "RecurringExpenseTemplate",
    "RefreshToken",
    "ScheduledReminder",
    "Service",
    "StoredBlob",
    "User",
    "Vendor",
    # enums
    "ArchiveState",
    "AuditAction",
    "CreditStatus",
    "CustomerStatus",
    "EmailTemplateKind",
    "ExpenseFrequency",
    "ExportFormat",
    "ExportState",
    "FileKind",
    "ItemKind",
    "NotificationKind",
    "NotificationState",
    "PaymentMethod",
    "ReminderAudience",
    "ReminderChannel",
    "ReminderStatus",
    "ReportPeriod",
    "RetentionPolicy",
]
