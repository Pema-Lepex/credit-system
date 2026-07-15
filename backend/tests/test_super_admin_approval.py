"""Super-admin approval: the gate, the state machine, and the purge.

These exercise the services exactly as the GraphQL layer calls them -- a real
ServiceContext per actor -- so the tenancy boundary and the approval gate are the
ones that ship.
"""

from __future__ import annotations

import pytest
from sqlmodel import Session, select

from app.core.errors import PermissionDeniedError, ValidationError
from app.core.security import Role, hash_password
from app.models.business import Business
from app.models.credit import Credit, Payment
from app.models.customer import Customer
from app.models.enums import ApprovalStatus
from app.models.user import User
from app.services.base import ServiceContext
from app.services.business import BusinessService
from app.services.customer import CustomerService


def _make_business(session: Session, *, status: ApprovalStatus, slug: str) -> tuple[Business, User]:
    biz = Business(name=f"Shop {slug}", slug=slug, email=f"{slug}@example.com", approval_status=status)
    session.add(biz)
    session.flush()
    owner = User(
        email=f"{slug}@example.com",
        hashed_password=hash_password("Password123"),
        full_name=f"Owner {slug}",
        role=Role.ADMIN,
        business_id=biz.id,
    )
    session.add(owner)
    session.commit()
    session.refresh(biz)
    session.refresh(owner)
    return biz, owner


def _ctx(session: Session, user: User, business_id: str | None = None) -> ServiceContext:
    return ServiceContext(session=session, user=user, business_id=business_id)


@pytest.fixture
def super_admin(session: Session) -> User:
    u = User(
        email="super@platform.local",
        hashed_password=hash_password("Password123"),
        full_name="Super Administrator",
        role=Role.SUPER_ADMIN,
        business_id=None,
    )
    session.add(u)
    session.commit()
    session.refresh(u)
    return u


# ---------------------------------------------------------------------------
# The gate
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("status", [ApprovalStatus.PENDING, ApprovalStatus.REJECTED, ApprovalStatus.SUSPENDED])
def test_non_approved_tenant_is_blocked_from_every_operation(session: Session, status: ApprovalStatus) -> None:
    biz, owner = _make_business(session, status=status, slug=f"blocked-{status.value.lower()}")
    ctx = _ctx(session, owner, biz.id)

    with pytest.raises(PermissionDeniedError) as exc:
        CustomerService(ctx).list()
    # The code names the state so a client can branch on it.
    assert exc.value.code == f"ACCOUNT_{status.value}"


def test_approved_tenant_operates_normally(session: Session) -> None:
    biz, owner = _make_business(session, status=ApprovalStatus.APPROVED, slug="ok")
    ctx = _ctx(session, owner, biz.id)
    # Does not raise.
    result = CustomerService(ctx).list()
    assert result.total == 0


def test_pending_owner_can_still_read_their_own_identity(session: Session) -> None:
    """A blocked owner must be able to sign in and read `me` to SEE their status."""
    from app.services.auth import AuthService

    biz, owner = _make_business(session, status=ApprovalStatus.PENDING, slug="pending-me")
    ctx = _ctx(session, owner, biz.id)
    # me() does not go through require()/scope_id, so it is never gated.
    assert AuthService(ctx).me().id == owner.id


# ---------------------------------------------------------------------------
# The state machine
# ---------------------------------------------------------------------------
def test_super_admin_approve_unblocks_the_tenant(session: Session, super_admin: User) -> None:
    biz, owner = _make_business(session, status=ApprovalStatus.PENDING, slug="to-approve")

    admin_ctx = _ctx(session, super_admin)
    updated = BusinessService(admin_ctx).set_approval(biz.id, ApprovalStatus.APPROVED)
    assert ApprovalStatus(updated.approval_status) is ApprovalStatus.APPROVED
    assert updated.approved_at is not None
    assert updated.approved_by_user_id == super_admin.id

    # The owner can now operate.
    owner_ctx = _ctx(session, owner, biz.id)
    assert CustomerService(owner_ctx).list().total == 0


def test_reject_and_suspend_require_a_reason(session: Session, super_admin: User) -> None:
    biz, _ = _make_business(session, status=ApprovalStatus.PENDING, slug="needs-reason")
    admin_ctx = _ctx(session, super_admin)
    svc = BusinessService(admin_ctx)

    with pytest.raises(ValidationError):
        svc.set_approval(biz.id, ApprovalStatus.REJECTED, reason="   ")
    with pytest.raises(ValidationError):
        svc.set_approval(biz.id, ApprovalStatus.SUSPENDED, reason=None)

    rejected = svc.set_approval(biz.id, ApprovalStatus.REJECTED, reason="Incomplete details")
    assert rejected.approval_reason == "Incomplete details"


def test_approving_clears_a_prior_reason(session: Session, super_admin: User) -> None:
    biz, _ = _make_business(session, status=ApprovalStatus.PENDING, slug="clears-reason")
    admin_ctx = _ctx(session, super_admin)
    svc = BusinessService(admin_ctx)

    svc.set_approval(biz.id, ApprovalStatus.SUSPENDED, reason="Chargeback")
    approved = svc.set_approval(biz.id, ApprovalStatus.APPROVED)
    assert approved.approval_reason is None


# ---------------------------------------------------------------------------
# Authorisation
# ---------------------------------------------------------------------------
def test_ordinary_admin_cannot_reach_the_admin_api(session: Session) -> None:
    biz, owner = _make_business(session, status=ApprovalStatus.APPROVED, slug="not-super")
    ctx = _ctx(session, owner, biz.id)

    with pytest.raises(PermissionDeniedError):
        BusinessService(ctx).admin_stats()
    with pytest.raises(PermissionDeniedError):
        BusinessService(ctx).set_approval(biz.id, ApprovalStatus.SUSPENDED, reason="x")


def test_admin_stats_counts_by_status(session: Session, super_admin: User) -> None:
    _make_business(session, status=ApprovalStatus.PENDING, slug="s1")
    _make_business(session, status=ApprovalStatus.PENDING, slug="s2")
    _make_business(session, status=ApprovalStatus.APPROVED, slug="s3")
    _make_business(session, status=ApprovalStatus.SUSPENDED, slug="s4")

    stats = BusinessService(_ctx(session, super_admin)).admin_stats()
    assert stats["pending"] == 2
    assert stats["approved"] == 1
    assert stats["suspended"] == 1
    assert stats["total"] == 4


# ---------------------------------------------------------------------------
# The purge
# ---------------------------------------------------------------------------
def test_hard_delete_removes_the_tenant_and_its_data(session: Session, super_admin: User) -> None:
    biz, owner = _make_business(session, status=ApprovalStatus.APPROVED, slug="doomed")
    # Give the tenant a customer so the RESTRICT-order path in _purge_tenant is exercised.
    session.add(Customer(business_id=biz.id, code="CUST-0001", name="Someone"))
    session.commit()
    # Capture ids before the purge: hard_delete expunges the identity map, so the
    # ORM instances are detached afterwards and reading `.id` off them would raise.
    biz_id, biz_name, owner_id = biz.id, biz.name, owner.id

    name = BusinessService(_ctx(session, super_admin)).hard_delete(biz_id)
    assert name == biz_name

    assert session.get(Business, biz_id) is None
    assert session.get(User, owner_id) is None
    assert session.exec(select(Customer).where(Customer.business_id == biz_id)).first() is None
    assert session.exec(select(Credit).where(Credit.business_id == biz_id)).first() is None
    assert session.exec(select(Payment).where(Payment.business_id == biz_id)).first() is None
