"""The audit trail records who did what, with the fields that changed.

The report the owner reads (Settings -> Activity log) is only as good as what the
services write. These tests pin the two things that report depends on: that a
mutation lands a row with the right action, and that an UPDATE carries a
field-level before/after diff -- not just "something changed".
"""

from __future__ import annotations

from sqlmodel import col, select

from app.models.enums import AuditAction
from app.models.retention import AuditLog
from app.services.base import ServiceContext
from app.services.customer import CustomerService


def _logs(ctx: ServiceContext, entity_type: str) -> list[AuditLog]:
    return list(
        ctx.session.exec(
            select(AuditLog)
            .where(AuditLog.entity_type == entity_type)
            .order_by(col(AuditLog.created_at))
        ).all()
    )


def test_create_and_update_are_recorded_with_a_field_diff(ctx: ServiceContext) -> None:
    svc = CustomerService(ctx)
    customer = svc.create(name="Dorji", phone="17111111")
    svc.update(customer.id, name="Dorji Wangchuk")

    logs = _logs(ctx, "customer")
    actions = [log.action for log in logs]
    assert AuditAction.CREATE in actions
    assert AuditAction.UPDATE in actions

    update = next(log for log in logs if log.action == AuditAction.UPDATE)
    # The diff names the field and carries both the old and the new value.
    assert "name" in update.changes
    before, after = update.changes["name"]
    assert before == "Dorji"
    assert after == "Dorji Wangchuk"
    # And it says who did it.
    assert update.actor_user_id == ctx.user.id


def test_every_row_is_scoped_to_the_business(ctx: ServiceContext) -> None:
    CustomerService(ctx).create(name="Pema", phone="17222222")
    logs = _logs(ctx, "customer")
    assert logs, "expected at least one audit row"
    assert all(log.business_id == ctx.business_id for log in logs)
