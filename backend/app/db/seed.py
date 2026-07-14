"""Demo seed data.

Run:  python -m app.db.seed          (idempotent -- safe to re-run)
      python -m app.db.seed --reset  (drop everything first)

Creates a realistic Bhutanese general store with customers in every state the UI
has to render: paid up, partially paid, overdue, blocked, and a customer with no
email (who therefore cannot be sent reminders). Seeding only the happy path is how
you ship a dashboard that looks perfect in the demo and falls apart on day one.
"""

from __future__ import annotations

import argparse
import random
from datetime import date, timedelta
from decimal import Decimal

from sqlmodel import Session, select

from app.core.config import settings
from app.core.security import Role, hash_password
from app.db.session import engine, init_db
from app.models.business import Business
from app.models.catalog import Category, Product, Service
from app.models.customer import Customer
from app.models.enums import CustomerStatus, PaymentMethod, RetentionPolicy
from app.models.user import User
from app.services.base import ServiceContext
from app.services.credit import CreditItemInput, CreditService
from app.services.payment import PaymentService
from app.services.templates import seed_default_templates

TODAY = date.today()
random.seed(42)  # deterministic demo data -- the same screenshots every time


def _drop_database() -> None:
    from pathlib import Path

    engine.dispose()
    if not settings.is_sqlite:
        print("--reset only supports SQLite. Drop the database by hand.")
        return
    db_file = Path(settings.DATABASE_URL.split("sqlite:///", 1)[-1])
    for path in (db_file, Path(f"{db_file}-wal"), Path(f"{db_file}-shm")):
        if path.exists():
            path.unlink()
    print(f"Removed {db_file}")

CUSTOMERS = [
    # (name, phone, email, status, notes)
    ("Dorji Wangchuk", "+975 17 11 22 33", "dorji@example.com", CustomerStatus.ACTIVE,
     "Buys groceries weekly. Always pays on time."),
    ("Pema Lhamo", "+975 17 44 55 66", "pema@example.com", CustomerStatus.ACTIVE,
     "Runs a small tea stall nearby."),
    ("Karma Tshering", "+975 17 77 88 99", "karma@example.com", CustomerStatus.ACTIVE,
     "Pays at the end of every month."),
    ("Sonam Choden", "+975 17 12 34 56", "sonam@example.com", CustomerStatus.ACTIVE, None),
    # No email -> the reminder planner must skip this one rather than queue a
    # reminder that can only fail.
    ("Ugyen Dorji", "+975 17 98 76 54", None, CustomerStatus.ACTIVE,
     "No email address -- reminds by phone."),
    ("Tandin Wangmo", "+975 17 65 43 21", "tandin@example.com", CustomerStatus.BLOCKED,
     "Owes a large amount. No further credit until settled."),
]

PRODUCTS = [
    # (name, sku, price, stock, unit, category)
    ("Rice 5kg (Bhutanese Red)", "RICE-5KG", "450.00", 40, "bag", "Groceries"),
    ("Cooking Oil 1L", "OIL-1L", "185.00", 25, "bottle", "Groceries"),
    ("Sugar 1kg", "SUG-1KG", "95.00", 60, "kg", "Groceries"),
    ("Wheat Flour 2kg", "FLR-2KG", "160.00", 30, "bag", "Groceries"),
    ("Milk Powder 500g", "MLK-500", "320.00", 18, "tin", "Groceries"),
    ("Tea Leaves 250g", "TEA-250", "140.00", 45, "pack", "Beverages"),
    ("Instant Noodles", "NDL-01", "35.00", 120, "pack", "Groceries"),
    ("Washing Powder 1kg", "WSH-1KG", "210.00", 22, "pack", "Household"),
    ("Soap Bar", "SOAP-01", "45.00", 80, "pcs", "Household"),
    ("Cooking Gas Refill", "GAS-REF", "950.00", 8, "cylinder", "Household"),
]

SERVICES = [
    ("Home Delivery", "DELIV", "50.00", 30),
    ("Gas Cylinder Installation", "GAS-INST", "100.00", 20),
]


def seed(reset: bool = False) -> None:
    if reset:
        # Delete the file rather than DROP TABLE: with foreign_keys=ON, SQLite
        # refuses to drop tables in an order that violates a constraint, and
        # metadata.drop_all() does not sort by dependency reliably across dialects.
        # Removing the file is unambiguous, and this is a dev-only seed script.
        _drop_database()

    init_db()

    with Session(engine) as session:
        existing = session.exec(select(Business)).first()
        if existing is not None and not reset:
            print(f"Database already seeded ({existing.name}). Use --reset to start over.")
            return

        # ---------------------------------------------------------------- business
        business = Business(
            name="Tashi General Store",
            slug="tashi-general-store",
            description="Family-run grocery and household store in Thimphu since 1998.",
            email="tashi.store@example.com",
            phone="+975 2 33 44 55",
            whatsapp_number="+975 17 11 00 11",
            address="Norzin Lam, Thimphu",
            city="Thimphu",
            country="Bhutan",
            currency="BTN",
            currency_symbol="Nu.",
            timezone="Asia/Thimphu",
            tax_percentage=Decimal("0"),
            reminders_enabled=True,
            reminder_days_before=[7, 3, 1],
            reminder_send_hour=9,
            retention_policy=RetentionPolicy.DAYS_30,
            brand_color="#4F46E5",
            working_hours={
                day: {"open": "08:00", "close": "20:00", "closed": False}
                for day in ("mon", "tue", "wed", "thu", "fri", "sat")
            }
            | {"sun": {"open": "09:00", "close": "13:00", "closed": False}},
        )
        session.add(business)
        session.flush()

        # ---------------------------------------------------------------- users
        owner = User(
            email=settings.FIRST_SUPERADMIN_EMAIL,
            hashed_password=hash_password(settings.FIRST_SUPERADMIN_PASSWORD),
            full_name="Tashi Dorji",
            phone="+975 17 11 00 11",
            role=Role.ADMIN,
            business_id=business.id,
        )
        staff = User(
            email="staff@creditsystem.local",
            hashed_password=hash_password(settings.FIRST_SUPERADMIN_PASSWORD),
            full_name="Sonam Staff",
            role=Role.STAFF,
            business_id=business.id,
        )
        session.add_all([owner, staff])
        session.flush()

        seed_default_templates(session, business.id)

        ctx = ServiceContext(session=session, user=owner, business_id=business.id)

        # ---------------------------------------------------------------- catalog
        categories: dict[str, Category] = {}
        for name, colour in [
            ("Groceries", "#10B981"),
            ("Household", "#6366F1"),
            ("Beverages", "#F59E0B"),
        ]:
            cat = Category(business_id=business.id, name=name, color=colour)
            session.add(cat)
            session.flush()
            categories[name] = cat

        products: list[Product] = []
        for name, sku, price, stock, unit, cat_name in PRODUCTS:
            p = Product(
                business_id=business.id,
                name=name,
                sku=sku,
                price=Decimal(price),
                stock_quantity=Decimal(stock),
                low_stock_threshold=Decimal("10"),
                unit=unit,
                category_id=categories[cat_name].id,
            )
            session.add(p)
            products.append(p)

        for name, code, price, minutes in SERVICES:
            session.add(
                Service(
                    business_id=business.id,
                    name=name,
                    code=code,
                    price=Decimal(price),
                    duration_minutes=minutes,
                )
            )
        session.flush()

        # ---------------------------------------------------------------- customers
        customers: list[Customer] = []
        for i, (name, phone, email, status, notes) in enumerate(CUSTOMERS, start=1):
            c = Customer(
                business_id=business.id,
                code=f"CUST-{i:04d}",
                name=name,
                phone=phone,
                email=email,
                # Everyone starts ACTIVE. The blocked customer is blocked AFTER their
                # credits exist -- which is both the realistic order of events (you
                # block someone because of the debt they already ran up) and the only
                # order the service permits: CreditService refuses to extend new
                # credit to a BLOCKED customer, and it is right to.
                status=CustomerStatus.ACTIVE,
                notes=notes,
                city="Thimphu",
                credit_limit=Decimal("10000.00"),
            )
            session.add(c)
            customers.append(c)
        session.flush()

        # ---------------------------------------------------------------- credits
        credits_service = CreditService(ctx)
        payments_service = PaymentService(ctx)

        # A spread of dates over the last 5 months so the dashboard charts have a
        # real trend to draw rather than one lonely spike.
        plan = [
            # (customer_idx, days_ago_issued, term_days, n_items, pay_fraction)
            (0, 120, 30, 3, 1.0),      # long settled
            (1, 110, 30, 2, 1.0),
            (2, 95, 30, 4, 1.0),
            (0, 80, 30, 2, 1.0),
            (3, 70, 30, 3, 1.0),
            (1, 60, 30, 2, 0.5),       # partially paid
            (2, 45, 30, 3, 1.0),
            (4, 40, 30, 2, 0.0),       # OVERDUE, no email -> no reminder possible
            (5, 35, 30, 5, 0.2),       # blocked customer, mostly unpaid, OVERDUE
            (0, 20, 30, 3, 0.6),       # partially paid, still open
            (3, 12, 30, 2, 0.0),       # pending
            (1, 5, 7, 2, 0.0),         # due in 2 days  -> reminder fires
            (2, 3, 10, 3, 0.0),        # due in 7 days  -> reminder fires
            (3, 1, 14, 4, 0.3),        # due in 13 days
            (0, 0, 7, 2, 0.0),         # due in 7 days  -> reminder fires today
        ]

        for cust_idx, days_ago, term, n_items, pay_fraction in plan:
            customer = customers[cust_idx]
            issued = TODAY - timedelta(days=days_ago)
            due = issued + timedelta(days=term)

            chosen = random.sample(products, k=min(n_items, len(products)))
            items = [
                CreditItemInput(
                    name=p.name,
                    quantity=Decimal(random.choice([1, 1, 2, 2, 3])),
                    unit_price=p.price,
                    product_id=p.id,
                )
                for p in chosen
            ]

            credit = credits_service.create(
                ctx,
                customer_id=customer.id,
                items=items,
                issued_date=issued,
                due_date=due,
                notes=random.choice(
                    [None, None, "Customer will settle after harvest.", "Regular monthly order."]
                ),
            )

            if pay_fraction > 0:
                amount = (credit.grand_total * Decimal(str(pay_fraction))).quantize(
                    Decimal("0.01")
                )
                if amount > 0:
                    payments_service.record(
                        ctx,
                        credit_id=credit.id,
                        amount=min(amount, credit.remaining_amount),
                        method=random.choice(
                            [PaymentMethod.CASH, PaymentMethod.CASH, PaymentMethod.MOBILE_MONEY]
                        ),
                        paid_at=None,
                    )

        # Now apply the real statuses -- the blocked customer has run up their debt.
        for customer, (_, _, _, status, _) in zip(customers, CUSTOMERS, strict=True):
            if status is not CustomerStatus.ACTIVE:
                customer.status = status
                session.add(customer)

        # Promote anything past its due date, exactly as the nightly job would.
        credits_service.promote_overdue(business_id=business.id, today=TODAY)

        session.commit()

        # ---------------------------------------------------------------- summary
        from app.services.analytics import AnalyticsService

        summary = AnalyticsService(ctx).dashboard_summary()
        print()
        print("  Seeded 'Tashi General Store'")
        print("  " + "-" * 52)
        print(f"  Customers        {len(customers)}")
        print(f"  Products         {len(products)}")
        print(f"  Credits          {len(plan)}")
        print(f"  Total credit     Nu. {summary.total_credit_value.value}")
        print(f"  Collected        Nu. {summary.total_revenue.value}")
        print(f"  Outstanding      Nu. {summary.pending_revenue.value}")
        print(f"  Overdue          {summary.overdue_count.value} credits")
        print("  " + "-" * 52)
        print(f"  Login  {settings.FIRST_SUPERADMIN_EMAIL}")
        print(f"  Pass   {settings.FIRST_SUPERADMIN_PASSWORD}")
        print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed demo data")
    parser.add_argument("--reset", action="store_true", help="drop all tables first")
    seed(reset=parser.parse_args().reset)
