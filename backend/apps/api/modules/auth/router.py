from __future__ import annotations

import asyncio
from dataclasses import asdict
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from apps.api.modules.auth import sms
from apps.api.modules.auth.store import AuthError
from apps.api.modules.auth.session import ADMIN_COOKIE, USER_COOKIE, session_cookie
from apps.api.modules.auth.profile import router as profile_router

router = APIRouter(tags=["authentication"])
router.include_router(profile_router)


class PhoneInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    phone: str = Field(min_length=11, max_length=16)

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value: str) -> str:
        import re
        value = value.strip()
        if value.startswith("+86"):
            value = value[3:]
        if not re.fullmatch(r"1[3-9][0-9]{9}", value):
            raise ValueError("请输入有效的中国大陆手机号。")
        return value


class PhoneLogin(PhoneInput):
    code: str = Field(pattern=r"^[0-9]{6}$")
    password: str = Field(min_length=6, max_length=128)


class PhonePasswordLogin(PhoneInput):
    password: str = Field(min_length=1, max_length=128)


class AdminLogin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=128)


def _ip(request: Request) -> str:
    # Never trust arbitrary X-Forwarded-For; configure trusted proxies at Uvicorn.
    return request.client.host if request.client else "unknown"


def _session(response: Response, request: Request, result) -> dict:
    identity, token = result
    cookie_name = ADMIN_COOKIE if identity.role == "admin" else USER_COOKIE
    old = request.cookies.get(cookie_name)
    request.app.state.auth_store.logout(old)
    response.set_cookie(cookie_name, token, httponly=True,
                        secure=request.app.state.settings.auth_cookie_secure,
                        samesite="lax", max_age=request.app.state.settings.auth_session_hours * 3600, path="/")
    response.headers["Cache-Control"] = "no-store"
    return {"user": asdict(identity)}


@router.get("/auth/status")
def status(request: Request) -> dict:
    settings = request.app.state.settings
    return {"enabled": getattr(settings, "auth_enabled", True), "sms_ready": sms.configured(settings),
            'billing_enabled': bool(getattr(settings, 'auth_enabled', False) and getattr(settings, 'billing_enabled', False))}


@router.post("/auth/sms")
async def send_code(payload: PhoneInput, request: Request) -> dict:
    settings, store = request.app.state.settings, request.app.state.auth_store
    if not sms.configured(settings):
        raise HTTPException(503, "短信服务尚未配置，请联系管理员。")
    try:
        code, nonce = await asyncio.to_thread(store.prepare_code, payload.phone, _ip(request), settings.sms_daily_limit)
        await sms.send_sms(settings, payload.phone, code)
        await asyncio.to_thread(store.activate_code, payload.phone, nonce)
    except AuthError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    except sms.SmsError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"sent": True, "retry_after": 60, "expires_in": 300}


@router.post("/auth/login")
def phone_login(payload: PhoneLogin, request: Request, response: Response) -> dict:
    try:
        result = request.app.state.auth_store.phone_login(payload.phone, payload.code, request.app.state.settings.auth_session_hours, payload.password)
    except AuthError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    return _session(response, request, result)


@router.post("/auth/admin/login")
def admin_login(payload: AdminLogin, request: Request, response: Response) -> dict:
    try:
        result = request.app.state.auth_store.admin_login(payload.username, payload.password, _ip(request), request.app.state.settings.auth_session_hours)
    except AuthError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    return _session(response, request, result)


@router.post("/auth/password/login")
def user_password_login(payload: PhonePasswordLogin, request: Request, response: Response) -> dict:
    try:
        result = request.app.state.auth_store.user_login(payload.phone, payload.password, _ip(request), request.app.state.settings.auth_session_hours)
    except AuthError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    return _session(response, request, result)


@router.get("/auth/me")
def me(request: Request, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    identity = getattr(request.state, "identity", None)
    if identity is None:
        raise HTTPException(401, "请先登录。")
    return {"user": asdict(identity)}


@router.post("/auth/logout")
def logout(request: Request, response: Response) -> dict:
    cookie_name = session_cookie(request.url.path, request.headers)
    request.app.state.auth_store.logout(request.cookies.get(cookie_name))
    response.delete_cookie(cookie_name, path="/", secure=request.app.state.settings.auth_cookie_secure, httponly=True, samesite="lax")
    return {"ok": True}


@router.get("/admin/overview")
def overview(request: Request, response: Response) -> dict:
    if getattr(getattr(request.state, "identity", None), "role", None) != "admin":
        raise HTTPException(403, "此操作仅限管理员。")
    response.headers["Cache-Control"] = "no-store"
    result = request.app.state.auth_store.overview()
    if getattr(request.app.state.settings, 'billing_enabled', False):
        result['revenue'] = request.app.state.billing_store.overview()
    return result
