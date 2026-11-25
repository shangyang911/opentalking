from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from apps.api.modules.auth.store import AuthError
from apps.api.modules.billing.store import BillingStore

router = APIRouter(tags=["billing"])


def store(request: Request):
    settings = request.app.state.settings
    if not getattr(settings, "auth_enabled", False) or not getattr(
        settings, "billing_enabled", False
    ):
        raise HTTPException(503, "会员服务未启用。")
    return request.app.state.billing_store


Store = Annotated[BillingStore, Depends(store)]


def user(request):
    identity = getattr(request.state, "identity", None)
    if not identity:
        raise HTTPException(401, "请先登录。")
    return identity.id


def admin(request):
    if getattr(getattr(request.state, "identity", None), "role", None) != "admin":
        raise HTTPException(403, "此操作仅限管理员。")
    return user(request)


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OrderInput(Input):
    plan_id: Literal["vip", "pack"]
    request_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")


class Receipt(Input):
    receipt: str = Field(min_length=1, max_length=128, pattern=r".*\S.*")


class Plan(Input):
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["vip", "pack"]
    price_fen: int = Field(ge=0, le=10000000)
    conversation_seconds: int = Field(ge=0, le=10000000)
    video_seconds: int = Field(ge=0, le=1000000)
    max_session_seconds: int = Field(ge=1, le=3600)
    valid_days: int = Field(ge=1, le=366)
    active: bool
    unlimited: bool = False


class Gift(Input):
    user_id: int = Field(gt=1)
    conversation_seconds: int = Field(ge=0, le=1000000)
    video_seconds: int = Field(ge=0, le=100000)
    valid_days: int = Field(ge=1, le=366)
    note: str = Field(min_length=1, max_length=255)
    request_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")


@router.get("/billing/me")
def me(request: Request, billing: Store):
    return billing.account(user(request))


@router.get("/billing/plans")
def plans(request: Request, billing: Store):
    user(request)
    return dict(
        plans=billing.plans(),
        payment_mode=billing.payment_mode,
        payment_instructions=getattr(
            request.app.state.settings, "billing_payment_instructions", ""
        ).strip(),
    )


@router.get('/billing/activity')
def activity(request: Request, billing: Store):
    return {'activity': billing.activity(user(request))}


@router.get("/billing/orders")
def orders(request: Request, billing: Store, before: Annotated[float | None, Query(gt=0)] = None):
    return dict(orders=billing.orders(user(request), before))


@router.post("/billing/orders")
def create_order(body: OrderInput, request: Request, billing: Store):
    return billing.create_order(user(request), body.plan_id, body.request_id)


@router.post("/billing/orders/{order_id}/cancel")
def cancel(order_id: str, request: Request, billing: Store):
    billing.cancel(order_id, user(request))
    return dict(ok=True)


@router.post('/billing/orders/{order_id}/demo-pay')
def demo_pay(order_id: str, request: Request, billing: Store) -> dict:
    return billing.submit_demo_payment(order_id, user(request))


@router.get("/billing/usage")
def usage(request: Request, billing: Store):
    return dict(usage=billing.usage(user(request)))


@router.get("/admin/billing")
def dashboard(
    request: Request, billing: Store, before: Annotated[float | None, Query(gt=0)] = None
):
    admin(request)
    with billing.auth.connect() as db:
        users = db.execute(
            "SELECT id,phone FROM auth_users WHERE role='user' ORDER BY id DESC LIMIT 100"
        ).fetchall()
    return dict(
        payment_mode=billing.payment_mode,
        overview=billing.overview(),
        orders=billing.orders(before=before),
        plans=billing.plans(True),
        usage=billing.usage(),
        users=users,
    )


@router.put("/admin/billing/plans/{plan_id}")
def save_plan(plan_id: Literal["vip", "pack"], body: Plan, request: Request, billing: Store):
    admin(request)
    return billing.save_plan(plan_id, body.model_dump())


@router.post("/admin/billing/orders/{order_id}/confirm")
def confirm(order_id: str, body: Receipt, request: Request, billing: Store):
    return billing.confirm(order_id, admin(request), body.receipt)


@router.post("/admin/billing/orders/{order_id}/refund")
def refund(order_id: str, body: Receipt, request: Request, billing: Store):
    billing.refund(order_id, admin(request), body.receipt.strip())
    return dict(ok=True)


@router.post('/admin/billing/orders/{order_id}/demo-confirm')
def demo_confirm(order_id: str, request: Request, billing: Store) -> dict:
    return billing.confirm(order_id, admin(request), f'DEMO-{order_id}', demo=True)


@router.post('/admin/billing/orders/{order_id}/demo-revoke')
def demo_revoke(order_id: str, request: Request, billing: Store) -> dict:
    billing.refund(order_id, admin(request), f'DEMO-REVOKE-{order_id}', demo=True)
    return dict(ok=True)


@router.post("/admin/billing/gifts")
def gift(body: Gift, request: Request, billing: Store):
    if body.conversation_seconds + body.video_seconds == 0:
        raise AuthError("赠送额度必须大于零。", 422)
    billing.gift(
        body.user_id,
        admin(request),
        body.conversation_seconds,
        body.video_seconds,
        body.valid_days,
        body.note,
        body.request_id,
    )
    return dict(ok=True)
