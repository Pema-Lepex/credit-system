"""Does taking a product on credit actually reduce its stock?

Reported as broken from the live app, on BOTH the credit form and the bulk
importer. These tests reproduce each path end to end rather than asserting on the
helper in isolation -- the helper was never the suspect.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from sqlmodel import Session, select

from app.models.catalog import Product
from app.models.customer import Customer
from app.models.enums import ItemKind
from app.services.base import ServiceContext
from app.services.credit import CreditItemInput, CreditService
from app.services.imports import ImportService

TODAY = date.today()
DUE = (TODAY + timedelta(days=30)).isoformat()


def _product(session: Session, ctx: ServiceContext, *, stock: str = "100") -> Product:
    product = Product(
        business_id=ctx.business_id,
        name="Rice 5kg",
        sku="RICE-5",
        price=Decimal("450"),
        stock_quantity=Decimal(stock),
        unit="bag",
    )
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


# ---------------------------------------------------------------------------
# The credit form path
# ---------------------------------------------------------------------------
def test_taking_a_product_on_credit_reduces_its_stock(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    product = _product(session, ctx, stock="100")

    CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        items=[
            CreditItemInput(
                name="Rice 5kg",
                quantity=Decimal("3"),
                unit_price=Decimal("450"),
                kind=ItemKind.PRODUCT,
                product_id=product.id,
            )
        ],
        due_date=TODAY + timedelta(days=30),
    )

    session.refresh(product)
    assert product.stock_quantity == Decimal("97.000")


def test_stock_is_allowed_to_go_negative(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    """models/catalog.py: a stale count must never block a sale."""
    product = _product(session, ctx, stock="2")

    CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        items=[
            CreditItemInput(
                name="Rice 5kg",
                quantity=Decimal("5"),
                unit_price=Decimal("450"),
                kind=ItemKind.PRODUCT,
                product_id=product.id,
            )
        ],
        due_date=TODAY + timedelta(days=30),
    )

    session.refresh(product)
    assert product.stock_quantity == Decimal("-3.000")


def test_a_free_text_line_touches_no_stock(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    product = _product(session, ctx, stock="100")

    CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        items=[
            CreditItemInput(
                name="Something not in the catalog",
                quantity=Decimal("3"),
                unit_price=Decimal("100"),
                kind=ItemKind.CUSTOM,
            )
        ],
        due_date=TODAY + timedelta(days=30),
    )

    session.refresh(product)
    assert product.stock_quantity == Decimal("100.000")


# ---------------------------------------------------------------------------
# The bulk import path
# ---------------------------------------------------------------------------
def test_an_imported_credit_reduces_stock_when_it_names_a_product(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    """THE reported bug. A sheet that names a product the shop already sells must
    move its stock, exactly as the credit form does."""
    product = _product(session, ctx, stock="100")

    header = "customer_code,item_name,quantity,unit_price,due_date,sku"
    row = f"{customer.code},Rice 5kg,4,450,{DUE},RICE-5"

    report = ImportService(ctx).run(
        ctx,
        dataset="credits",
        filename="sheet.csv",
        data=f"{header}\n{row}".encode(),
        dry_run=False,
    )

    assert report.ok, [e.message for e in report.errors]
    session.refresh(product)
    assert product.stock_quantity == Decimal("96.000")


def test_an_imported_credit_with_no_product_match_is_still_accepted(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    """A shop importing history for things it no longer stocks must not be blocked."""
    _product(session, ctx, stock="100")

    header = "customer_code,item_name,quantity,unit_price,due_date"
    row = f"{customer.code},Some old thing,2,50,{DUE}"

    report = ImportService(ctx).run(
        ctx,
        dataset="credits",
        filename="sheet.csv",
        data=f"{header}\n{row}".encode(),
        dry_run=False,
    )

    assert report.ok, [e.message for e in report.errors]


def test_an_imported_credit_with_a_blank_sku_moves_no_stock(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    """The opt-in, from the other side.

    Backfilling a paper ledger must NOT move stock: those goods left the shelf
    months ago, and re-deducting them would leave every count wrong by the size of
    the shop's own history. A blank SKU is how you say "this already happened".
    """
    product = _product(session, ctx, stock="100")

    header = "customer_code,item_name,quantity,unit_price,due_date,sku"
    row = f"{customer.code},Rice 5kg,4,450,{DUE},"

    report = ImportService(ctx).run(
        ctx,
        dataset="credits",
        filename="sheet.csv",
        data=f"{header}\n{row}".encode(),
        dry_run=False,
    )

    assert report.ok, [e.message for e in report.errors]
    session.refresh(product)
    assert product.stock_quantity == Decimal("100.000")


def test_an_unknown_sku_stops_the_batch(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    """A typo'd SKU is a mistake, not a silent one-off item -- otherwise stock
    quietly fails to move and nobody finds out."""
    product = _product(session, ctx, stock="100")

    header = "customer_code,item_name,quantity,unit_price,due_date,sku"
    row = f"{customer.code},Rice 5kg,4,450,{DUE},RICE-TYPO"

    report = ImportService(ctx).run(
        ctx,
        dataset="credits",
        filename="sheet.csv",
        data=f"{header}\n{row}".encode(),
        dry_run=False,
    )

    assert not report.ok
    assert any("no product with the SKU" in e.message for e in report.errors)
    session.refresh(product)
    assert product.stock_quantity == Decimal("100.000")


def test_sku_matching_ignores_casing(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    product = _product(session, ctx, stock="100")

    header = "customer_code,item_name,quantity,unit_price,due_date,sku"
    row = f"{customer.code},Rice 5kg,2,450,{DUE},rice-5"

    report = ImportService(ctx).run(
        ctx,
        dataset="credits",
        filename="sheet.csv",
        data=f"{header}\n{row}".encode(),
        dry_run=False,
    )

    assert report.ok, [e.message for e in report.errors]
    session.refresh(product)
    assert product.stock_quantity == Decimal("98.000")


def test_a_dry_run_import_moves_no_stock(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    product = _product(session, ctx, stock="100")

    header = "customer_code,item_name,quantity,unit_price,due_date,sku"
    row = f"{customer.code},Rice 5kg,4,450,{DUE},RICE-5"

    ImportService(ctx).run(
        ctx,
        dataset="credits",
        filename="sheet.csv",
        data=f"{header}\n{row}".encode(),
        dry_run=True,
    )

    session.refresh(product)
    assert product.stock_quantity == Decimal("100.000")


# ---------------------------------------------------------------------------
# The products export / report
# ---------------------------------------------------------------------------
def test_the_products_export_shows_the_reduced_stock(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    from app.services.export import ExportService

    product = _product(session, ctx, stock="100")
    CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        items=[
            CreditItemInput(
                name="Rice 5kg",
                quantity=Decimal("10"),
                unit_price=Decimal("450"),
                kind=ItemKind.PRODUCT,
                product_id=product.id,
            )
        ],
        due_date=TODAY + timedelta(days=30),
    )

    dataset = ExportService(ctx)._build_dataset("products", {})  # noqa: SLF001
    row = next(r for r in dataset.rows if r[0] == "Rice 5kg")
    stock_column = dataset.headers.index("Stock")

    assert str(row[stock_column]).startswith("90")


def test_stock_survives_a_reread_from_the_database(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    """Guards the failure mode where the decrement happens on an in-memory object
    but is never flushed -- the API would look right until the next request."""
    product = _product(session, ctx, stock="100")
    product_id = product.id

    CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        items=[
            CreditItemInput(
                name="Rice 5kg",
                quantity=Decimal("7"),
                unit_price=Decimal("450"),
                kind=ItemKind.PRODUCT,
                product_id=product_id,
            )
        ],
        due_date=TODAY + timedelta(days=30),
    )

    session.expire_all()
    fresh = session.exec(select(Product).where(Product.id == product_id)).one()
    assert fresh.stock_quantity == Decimal("93.000")
