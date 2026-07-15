"""Test fixtures.

Each test gets a fresh in-memory SQLite database and a real ServiceContext, so the
services are exercised exactly as the GraphQL layer will call them -- including the
tenancy boundary and the audit trail.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

import app.models  # noqa: F401  (registers every table)
from app.core.security import Role, hash_password
from app.models.business import Business
from app.models.customer import Customer
from app.models.enums import ApprovalStatus
from app.models.user import User
from app.services.base import ServiceContext


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,  # one connection => the in-memory DB survives the test
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


@pytest.fixture
def business(session: Session) -> Business:
    b = Business(
        name="Tashi General Store",
        slug="tashi-general-store",
        email="owner@tashi.bt",
        currency="BTN",
        currency_symbol="Nu.",
        timezone="Asia/Thimphu",
        tax_percentage=0,
        # An operating shop: the approval gate (BaseService._assert_tenant_usable)
        # blocks every tenant operation until APPROVED, and these fixtures exercise
        # the approved-tenant behaviour. Registration is the only path that yields a
        # PENDING business; that flow is covered separately.
        approval_status=ApprovalStatus.APPROVED,
    )
    session.add(b)
    session.commit()
    session.refresh(b)
    return b


@pytest.fixture
def admin(session: Session, business: Business) -> User:
    u = User(
        email="owner@tashi.bt",
        hashed_password=hash_password("Password123"),
        full_name="Tashi Owner",
        role=Role.ADMIN,
        business_id=business.id,
    )
    session.add(u)
    session.commit()
    session.refresh(u)
    return u


@pytest.fixture
def ctx(session: Session, admin: User, business: Business) -> ServiceContext:
    return ServiceContext(session=session, user=admin, business_id=business.id)


@pytest.fixture
def customer(session: Session, business: Business) -> Customer:
    c = Customer(
        business_id=business.id,
        code="CUST-0001",
        name="Dorji Wangchuk",
        phone="+975 17 12 34 56",
        email="dorji@example.com",
    )
    session.add(c)
    session.commit()
    session.refresh(c)
    return c
