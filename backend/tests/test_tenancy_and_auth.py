"""The security boundary.

A multi-tenant credit system in which shop A can read shop B's customers is not a
bug, it is a catastrophe. These tests assert the boundary holds on every path that
can reach a row: by list, by id, by number, and by mutation.

They also cover the auth paths where a subtle mistake leaks information: user
enumeration, privilege escalation, and token revocation.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlmodel import Session

from app.core.errors import (
    AuthenticationError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from app.core.security import Role, hash_password
from app.models.business import Business
from app.models.customer import Customer
from app.models.enums import ApprovalStatus
from app.models.user import User
from app.services.auth import AuthService
from app.services.base import ServiceContext
from app.services.credit import CreditItemInput, CreditService
from app.services.customer import CustomerService
from app.services.user import UserService

TOMORROW = date.today() + timedelta(days=30)


# ---------------------------------------------------------------------------
# A second, entirely separate tenant
# ---------------------------------------------------------------------------
@pytest.fixture
def rival(session: Session) -> tuple[Business, User, Customer, ServiceContext]:
    biz = Business(
        name="Rival Shop",
        slug="rival-shop",
        email="rival@example.com",
        approval_status=ApprovalStatus.APPROVED,  # an operating tenant, like the primary one
    )
    session.add(biz)
    session.flush()

    admin = User(
        email="rival@example.com",
        hashed_password=hash_password("Password123"),
        full_name="Rival Owner",
        role=Role.ADMIN,
        business_id=biz.id,
    )
    cust = Customer(
        business_id=biz.id, code="CUST-0001", name="Rival Customer", phone="999"
    )
    session.add_all([admin, cust])
    session.commit()

    ctx = ServiceContext(session=session, user=admin, business_id=biz.id)
    return biz, admin, cust, ctx


# ---------------------------------------------------------------------------
# Tenancy
# ---------------------------------------------------------------------------
def test_list_never_returns_another_tenants_rows(
    ctx: ServiceContext, customer: Customer, rival: tuple
) -> None:
    _, _, rival_customer, rival_ctx = rival

    mine = CustomerService(ctx).list()
    theirs = CustomerService(rival_ctx).list()

    my_ids = {c.id for c in mine.items}
    their_ids = {c.id for c in theirs.items}

    assert customer.id in my_ids
    assert rival_customer.id not in my_ids
    assert rival_customer.id in their_ids
    assert customer.id not in their_ids
    assert my_ids.isdisjoint(their_ids)


def test_get_by_id_across_tenants_raises_not_found(
    ctx: ServiceContext, rival: tuple
) -> None:
    """Guessing another tenant's UUID must not read it.

    NotFound, not Forbidden: "that exists but isn't yours" would itself confirm the
    existence of another tenant's record.
    """
    _, _, rival_customer, _ = rival

    with pytest.raises(NotFoundError):
        CustomerService(ctx).get(rival_customer.id)


def test_cannot_create_a_credit_against_another_tenants_customer(
    ctx: ServiceContext, rival: tuple
) -> None:
    _, _, rival_customer, _ = rival

    with pytest.raises(NotFoundError):
        CreditService(ctx).create(
            ctx,
            customer_id=rival_customer.id,
            due_date=TOMORROW,
            items=[
                CreditItemInput(
                    name="Rice", quantity=Decimal("1"), unit_price=Decimal("100")
                )
            ],
        )


def test_a_forged_business_id_in_the_context_is_rejected(
    session: Session, admin: User, rival: tuple
) -> None:
    """The GraphQL layer passes a business_id through. An ADMIN who smuggles someone
    else's must be REJECTED, not silently pinned back to their own -- a silent
    fallback would turn a probing client into a no-op instead of a logged failure.
    """
    rival_business, _, _, _ = rival

    forged = ServiceContext(
        session=session, user=admin, business_id=rival_business.id  # not theirs
    )
    with pytest.raises(PermissionDeniedError, match="Cross-business"):
        _ = CustomerService(forged).list()


def test_credit_by_number_is_tenant_scoped(
    ctx: ServiceContext, customer: Customer, rival: tuple
) -> None:
    """Credit numbers restart per business, so CR-2026-0001 exists in BOTH tenants.
    Looking it up must return YOUR one."""
    _, _, rival_customer, rival_ctx = rival

    mine = CreditService(ctx).create(
        ctx, customer_id=customer.id, due_date=TOMORROW,
        items=[CreditItemInput(name="A", quantity=Decimal("1"), unit_price=Decimal("100"))],
    )
    theirs = CreditService(rival_ctx).create(
        rival_ctx, customer_id=rival_customer.id, due_date=TOMORROW,
        items=[CreditItemInput(name="B", quantity=Decimal("1"), unit_price=Decimal("999"))],
    )
    assert mine.number == theirs.number  # both CR-<year>-0001

    found = CreditService(ctx).get_by_number(mine.number)
    assert found.id == mine.id
    assert found.grand_total == Decimal("100.00")   # not 999 -- we got OUR credit


# ---------------------------------------------------------------------------
# Privilege escalation
# ---------------------------------------------------------------------------
def test_staff_cannot_delete_a_credit(
    session: Session, business: Business, customer: Customer, ctx: ServiceContext
) -> None:
    staff = User(
        email="staff@tashi.bt",
        hashed_password=hash_password("Password123"),
        full_name="Staff",
        role=Role.STAFF,
        business_id=business.id,
    )
    session.add(staff)
    session.commit()

    credit = CreditService(ctx).create(
        ctx, customer_id=customer.id, due_date=TOMORROW,
        items=[CreditItemInput(name="A", quantity=Decimal("1"), unit_price=Decimal("100"))],
    )

    staff_ctx = ServiceContext(session=session, user=staff, business_id=business.id)
    with pytest.raises(PermissionDeniedError):
        CreditService(staff_ctx).soft_delete(staff_ctx, credit.id)

    # ...but staff CAN do their job.
    assert CreditService(staff_ctx).get(credit.id).id == credit.id


def test_admin_cannot_promote_anyone_to_super_admin(
    ctx: ServiceContext, session: Session
) -> None:
    """Otherwise ADMIN is just SUPER_ADMIN with extra steps."""
    with pytest.raises((PermissionDeniedError, ValidationError)):
        UserService(ctx).create(
            email="escalate@evil.com",
            full_name="Escalation",
            password="Password123",
            role=Role.SUPER_ADMIN,
        )


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def test_login_does_not_reveal_whether_an_email_exists(
    ctx: ServiceContext, admin: User
) -> None:
    """The message for 'no such user' and 'wrong password' must be IDENTICAL."""
    service = AuthService(ctx)

    with pytest.raises(AuthenticationError) as unknown:
        service.login("nobody@nowhere.com", "whatever")

    with pytest.raises(AuthenticationError) as wrong_password:
        service.login(admin.email, "definitely-not-the-password")

    assert str(unknown.value) == str(wrong_password.value)


def test_password_reset_is_silent_for_an_unknown_address(ctx: ServiceContext) -> None:
    """Returning None (rather than raising) is what lets the API say the same thing
    either way -- otherwise the endpoint is a free account-enumeration oracle."""
    assert AuthService(ctx).request_password_reset("nobody@nowhere.com") is None


def test_successful_login_issues_working_tokens(ctx: ServiceContext, admin: User) -> None:
    user, access, refresh = AuthService(ctx).login(admin.email, "Password123")
    assert user.id == admin.id
    assert access and refresh
    assert access != refresh


def test_refresh_rotates_and_invalidates_the_old_token(
    ctx: ServiceContext, admin: User, session: Session
) -> None:
    """A refresh token is single-use. Replaying one must fail -- that is what makes a
    stolen token a bounded problem rather than a permanent one."""
    service = AuthService(ctx)
    _, _, refresh_1 = service.login(admin.email, "Password123")
    session.commit()

    _, _, refresh_2 = service.refresh(refresh_1)
    session.commit()
    assert refresh_2 != refresh_1

    with pytest.raises(AuthenticationError):
        service.refresh(refresh_1)   # the old one is dead


def test_account_locks_after_repeated_failures(
    ctx: ServiceContext, admin: User, session: Session
) -> None:
    service = AuthService(ctx)
    for _ in range(5):
        with pytest.raises(AuthenticationError):
            service.login(admin.email, "wrong")
        session.commit()

    # Even the CORRECT password is now refused.
    with pytest.raises(AuthenticationError):
        service.login(admin.email, "Password123")
