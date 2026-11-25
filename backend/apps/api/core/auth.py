from __future__ import annotations

import asyncio
import re
import time
from http.cookies import SimpleCookie
from urllib.parse import urlsplit

from fastapi import FastAPI
import pymysql
from starlette.responses import JSONResponse

from apps.api.modules.auth.store import AuthError, AuthStore
from apps.api.modules.auth.session import ADMIN_COOKIE, session_cookie
from opentalking.core.identity import current_identity
from opentalking.core.identity import avatar_accessible
from opentalking.core.metering import Meter, current_meter, reserve_quota

PUBLIC_PATHS = {"/healthz", "/auth/status", "/auth/sms", "/auth/login", "/auth/admin/login", "/auth/password/login"}


class AuthMiddleware:
    def __init__(self, app, owner: FastAPI):
        self.app, self.owner = app, owner

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"}:
            return await self.app(scope, receive, send)
        settings = self.owner.state.settings
        if not getattr(settings, "auth_enabled", False):
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        path = scope["path"].rstrip("/") or "/"
        websocket = scope["type"] == "websocket"

        async def reject(status, message):
            if websocket:
                await send({"type": "websocket.close", "code": 4401 if status == 401 else 4403})
            else:
                await JSONResponse({"detail": message}, status_code=status)(scope, receive, send)

        if scope.get("method") == "OPTIONS":
            return await self.app(scope, receive, send)
        if websocket or scope.get("method") not in {"GET", "HEAD"}:
            origin = headers.get("origin")
            if origin:
                parsed = urlsplit(origin)
                same_origin = parsed.scheme in {"http", "https"} and parsed.netloc.lower() == headers.get("host", "").lower()
                allowed = getattr(settings, "cors_origin_list", [])
                if not same_origin and origin not in [item for item in allowed if item != "*"]:
                    return await reject(403, "请求来源不被允许。")
        store = self.owner.state.auth_store
        if path in {"/healthz", "/auth/status"}:
            return await self.app(scope, receive, send)
        try:
            await asyncio.to_thread(store.bootstrap, settings)
        except (pymysql.MySQLError, ValueError, AuthError):
            return await reject(503, "数据库或管理员配置不可用，请联系管理员。")
        cookie = SimpleCookie()
        try:
            cookie.load(headers.get("cookie", ""))
        except Exception:
            return await reject(401, "请先登录。")
        cookie_name = session_cookie(path, headers)
        raw = cookie.get(cookie_name)
        try:
            identity = await asyncio.to_thread(store.resolve, raw.value if raw else None)
        except pymysql.MySQLError:
            return await reject(503, "数据库暂时不可用，请稍后重试。")
        expected_role = "admin" if cookie_name == ADMIN_COOKIE else "user"
        if identity and identity.role != expected_role:
            identity = None
        if path in PUBLIC_PATHS:
            return await self.app(scope, receive, send)
        if not identity:
            return await reject(401, "登录已失效，请重新登录。")
        expected_account = headers.get("x-opentalking-account")
        if expected_account is not None and expected_account != str(identity.id):
            return await reject(401, "登录账号已切换，请重新加载工作台。")
        if (path.startswith("/admin") or path.startswith("/runtime-config") and scope.get("method") != "GET") and identity.role != "admin":
            return await reject(403, "此操作仅限管理员。")
        match = re.match(r"^/sessions/([^/]+)", path)
        if match and match[1] not in {"webrtc", "customize"} and identity.role != "admin":
            redis = getattr(self.owner.state, "redis", None)
            owner = await redis.hget(f"opentalking:session:{match[1]}", "user_id") if redis else None
            if isinstance(owner, bytes):
                owner = owner.decode()
            if str(owner or "") != str(identity.id):
                return await reject(404, "会话不存在。")
        scope.setdefault("state", {})["identity"] = identity
        token = current_identity.set(identity)
        meter_token = current_meter.set(None)
        auxiliary = None
        response_status = 500
        response_started = False
        try:
            if identity.role == 'user' and getattr(settings, 'billing_enabled', False):
                meter = Meter(self.owner.state.billing_store, identity.id, 'request', settings)
                if match and (websocket or path.rsplit('/', 1)[-1] in {'speak', 'speak_audio', 'speak_flashtalk_audio', 'transcribe', 'flashtalk-offline-bundle'}):
                    from apps.api.modules.billing.lifecycle import guard_session
                    try:
                        row = await guard_session(meter.sink, identity.id, match[1])
                    except AuthError as exc:
                        return await reject(exc.status, str(exc))
                    meter.resource_id, meter.deadline = match[1], row['expires_at']
                    try:
                        await asyncio.to_thread(meter.sink.limit_action, identity.id, 'input')
                    except AuthError as exc:
                        return await reject(exc.status, str(exc))
                    if path.endswith('/flashtalk-offline-bundle'):
                        return await reject(403, '请使用视频创作入口生成视频。')
                if scope.get('method') == 'POST' and (path.startswith('/tts/preview') or path == '/voices/clone'):
                    import uuid
                    action = 'clone' if path == '/voices/clone' else 'preview'
                    try:
                        await asyncio.to_thread(meter.sink.limit_action, identity.id, action)
                        auxiliary = f'aux_{action}_' + uuid.uuid4().hex
                        # Keep previews finite and charge their actual generated audio.
                        allocation = await reserve_quota(meter.sink, identity.id, auxiliary, 'conversation', 'mock', 60 if action == 'clone' else 15)
                        if action == 'clone' and allocation['seconds'] < 60:
                            raise AuthError('创建专属声音需要至少 60 秒对话额度。', 402)
                        running = await asyncio.to_thread(meter.sink.start, auxiliary)
                        meter.deadline = running['expires_at']
                        meter.resource_id = auxiliary
                        meter.video_seconds = allocation['seconds']
                    except AuthError as exc:
                        return await reject(exc.status, str(exc))
                current_meter.set(meter)
            avatar_match = re.match(r"^/avatars/([^/]+)", path)
            if avatar_match and avatar_match[1] != "custom":
                from pathlib import Path
                directory = (Path(settings.avatars_dir).resolve() / avatar_match[1]).resolve()
                modify = scope.get("method") in {"DELETE", "PATCH", "PUT"}
                if not avatar_accessible(directory, modify=modify):
                    return await reject(404, "形象不存在。")
            async def private_send(message):
                nonlocal response_status, response_started
                if message["type"] == "http.response.start":
                    response_started = True
                    response_status = message['status']
                    response_headers = [(key, value) for key, value in message.get("headers", []) if key.lower() != b"cache-control"]
                    response_headers.append((b"cache-control", b"no-store"))
                    message["headers"] = response_headers
                await send(message)
            if auxiliary:
                try:
                    async with asyncio.timeout(max(0, meter.deadline - time.time())):
                        await self.app(scope, receive, private_send)
                except TimeoutError:
                    if response_started:
                        raise
                    return await reject(504, '服务处理超时，本次未用额度已退回，请稍后重试。')
            else:
                await self.app(scope, receive, private_send)
        finally:
            try:
                if auxiliary:
                    meter = current_meter.get()
                    used = max(1, meter.audio_seconds) if meter and meter.audio_seconds else 0
                    if path == '/voices/clone':
                        used = 60 if response_status < 400 else 0
                        if meter:
                            await meter.emit('voice_clone', 'configured', {'requests': 1}, False)
                    await asyncio.to_thread(self.owner.state.billing_store.finish, auxiliary, used)
            finally:
                current_meter.reset(meter_token)
                current_identity.reset(token)


def install_auth(app: FastAPI, settings) -> None:
    app.state.settings = settings
    app.state.auth_store = AuthStore(settings)
    from apps.api.modules.billing.store import BillingStore
    app.state.billing_store = BillingStore(app.state.auth_store)
    app.add_middleware(AuthMiddleware, owner=app)

    async def database_error(request, exc):
        return JSONResponse({"detail": "数据库暂时不可用，请稍后重试。"}, status_code=503)

    app.add_exception_handler(pymysql.MySQLError, database_error)

    async def billing_error(request, exc):
        return JSONResponse({'detail': str(exc)}, status_code=exc.status)

    app.add_exception_handler(AuthError, billing_error)
