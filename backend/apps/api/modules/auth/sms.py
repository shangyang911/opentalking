"""Backend-only Spug verification SMS and Tencent TC3-signed SendSms."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import time
from datetime import datetime, timezone

import httpx
from loguru import logger


class _RedactSpugUrl(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # httpx logs request URLs at INFO; Spug's URL contains the credential.
        record.msg = re.sub(r"https://push\.spug\.cc/sms/[^\s\"']+",
                            "https://push.spug.cc/sms/[REDACTED]", record.getMessage())
        record.args = ()
        return True


logging.getLogger("httpx").addFilter(_RedactSpugUrl())


class SmsError(Exception):
    pass


def configured(settings) -> bool:
    provider = getattr(settings, "sms_provider", "tencent")
    if provider == "spug":
        return bool(re.fullmatch(r"[A-Za-z0-9_-]{1,128}",
                                 getattr(settings, "spug_sms_template_code", "")))
    if provider != "tencent":
        return False
    return all(getattr(settings, name, "") for name in (
        "tencent_sms_secret_id", "tencent_sms_secret_key", "tencent_sms_sdk_app_id",
        "tencent_sms_sign_name", "tencent_sms_template_id",
    ))


def signed_request(settings, phone: str, code: str, timestamp: int) -> tuple[bytes, dict[str, str]]:
    body = json.dumps({
        "PhoneNumberSet": ["+86" + phone], "SmsSdkAppId": settings.tencent_sms_sdk_app_id,
        "SignName": settings.tencent_sms_sign_name, "TemplateId": settings.tencent_sms_template_id,
        "TemplateParamSet": [code],
    }, ensure_ascii=False, separators=(",", ":")).encode()
    date = datetime.fromtimestamp(timestamp, timezone.utc).strftime("%Y-%m-%d")
    host = "sms.tencentcloudapi.com"
    canonical = "POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:" + host + "\n\ncontent-type;host\n" + hashlib.sha256(body).hexdigest()
    scope = f"{date}/sms/tc3_request"
    string_to_sign = f"TC3-HMAC-SHA256\n{timestamp}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"

    def sign(key: bytes, message: str) -> bytes:
        return hmac.new(key, message.encode(), hashlib.sha256).digest()

    key = sign(("TC3" + settings.tencent_sms_secret_key).encode(), date)
    key = sign(sign(key, "sms"), "tc3_request")
    signature = sign(key, string_to_sign).hex()
    return body, {
        "Content-Type": "application/json; charset=utf-8", "Host": host,
        "Authorization": f"TC3-HMAC-SHA256 Credential={settings.tencent_sms_secret_id}/{scope}, SignedHeaders=content-type;host, Signature={signature}",
        "X-TC-Action": "SendSms", "X-TC-Version": "2021-01-11",
        "X-TC-Timestamp": str(timestamp), "X-TC-Region": settings.tencent_sms_region,
    }


async def send_sms(settings, phone: str, code: str) -> None:
    if not configured(settings):
        raise SmsError("短信服务尚未配置，请联系管理员。")
    if getattr(settings, "sms_provider", "tencent") == "spug":
        await _send_spug(settings, phone, code)
        return
    body, headers = signed_request(settings, phone, code, int(time.time()))
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post("https://sms.tencentcloudapi.com/", content=body, headers=headers)
            response.raise_for_status()
            payload = response.json()["Response"]
        statuses = payload.get("SendStatusSet", [])
        if payload.get("Error") or len(statuses) != 1 or statuses[0].get("Code") != "Ok":
            raise SmsError("短信发送失败，请稍后重试或联系管理员。")
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise SmsError("短信服务暂时不可用，请稍后重试。") from exc


async def _send_spug(settings, phone: str, code: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                "https://push.spug.cc/sms/" + settings.spug_sms_template_code,
                json={"to": phone, "code": code, "number": "5"},
            )
            response.raise_for_status()
            payload = response.json()
        if not isinstance(payload, dict) or payload.get("code") != 200:
            message = "短信发送失败，请稍后重试或联系管理员。"
            reason = "provider_rejected"
            detail = payload.get("msg", "") if isinstance(payload, dict) else ""
            if isinstance(detail, str):
                # Classify known blockers without exposing the provider's raw text.
                for pattern, category, notice in (
                    ("实名", "verification_required", "短信服务尚未完成实名认证，请联系管理员。"),
                    ("余额|额度|资源包", "quota", "短信余额或额度不足，请联系管理员。"),
                    ("模板|编码", "template", "短信模板配置无效，请联系管理员。"),
                    ("白名单", "ip_allowlist", "短信服务 IP 白名单限制，请联系管理员。"),
                ):
                    if re.search(pattern, detail):
                        reason, message = category, notice
                        break
            provider_code = payload.get("code") if isinstance(payload, dict) else None
            logger.warning("Spug SMS rejected: code={}, reason={}",
                           provider_code if type(provider_code) is int else "invalid", reason)
            raise SmsError(message)
        request_id = payload.get("request_id")
        if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", request_id):
            raise SmsError("短信服务返回异常，请稍后重试。")
        # An accepted request is queued; delivery can be checked in Spug logs.
        logger.info("Spug SMS request accepted: request_id={}", request_id)
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise SmsError("短信服务暂时不可用，请稍后重试。") from exc
