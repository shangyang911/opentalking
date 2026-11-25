import json
import logging
from types import SimpleNamespace

import httpx
import pytest

from apps.api.modules.auth import sms


def settings(**overrides):
    return SimpleNamespace(**dict({
        "sms_provider": "spug", "spug_sms_template_code": "test-template-code",
        "tencent_sms_secret_id": "", "tencent_sms_secret_key": "",
        "tencent_sms_sdk_app_id": "", "tencent_sms_sign_name": "",
        "tencent_sms_template_id": "",
    }, **overrides))


@pytest.mark.parametrize(("overrides", "ready"), [
    ({}, True), ({"spug_sms_template_code": ""}, False),
    ({"spug_sms_template_code": "  "}, False),
    ({"spug_sms_template_code": "https://example.com/secret"}, False),
    ({"sms_provider": "unknown"}, False), ({"sms_provider": "tencent"}, False),
])
def test_readiness_requires_selected_provider_credentials(overrides, ready):
    assert sms.configured(settings(**overrides)) is ready


async def test_spug_posts_one_phone_and_five_minute_code(monkeypatch, caplog):
    real_client = httpx.AsyncClient

    def handle(request):
        assert request.method == "POST"
        assert str(request.url) == "https://push.spug.cc/sms/test-template-code"
        assert not request.url.query
        assert json.loads(request.content) == {
            "to": "13800138000", "code": "012345", "number": "5",
        }
        return httpx.Response(200, json={"code": 200, "request_id": "test-request"})

    monkeypatch.setattr(sms.httpx, "AsyncClient", lambda **kw: real_client(
        transport=httpx.MockTransport(handle), **kw))
    with caplog.at_level(logging.INFO, logger="httpx"):
        await sms.send_sms(settings(), "13800138000", "012345")
    assert "test-template-code" not in caplog.text
    assert "[REDACTED]" in caplog.text


@pytest.mark.parametrize("payload", [
    {"code": 400, "msg": "private provider detail"}, {"code": 200},
    {"code": 200, "request_id": ""}, {"code": 200, "request_id": 123},
    {"code": "200", "request_id": "test"}, [], None,
])
async def test_spug_rejects_unsuccessful_or_malformed_response(monkeypatch, payload):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(sms.httpx, "AsyncClient", lambda **kw: real_client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload)), **kw))
    with pytest.raises(sms.SmsError) as error:
        await sms.send_sms(settings(), "13800138000", "123456")
    assert "private provider detail" not in str(error.value)
    assert "test-template-code" not in str(error.value)


@pytest.mark.parametrize("failure", ["http", "json", "timeout"])
async def test_spug_transport_failure_is_safe(monkeypatch, failure):
    real_client = httpx.AsyncClient

    def handle(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("test-template-code", request=request)
        return httpx.Response(503 if failure == "http" else 200, text="invalid JSON")

    monkeypatch.setattr(sms.httpx, "AsyncClient", lambda **kw: real_client(
        transport=httpx.MockTransport(handle), **kw))
    with pytest.raises(sms.SmsError) as error:
        await sms.send_sms(settings(), "13800138000", "123456")
    assert "test-template-code" not in str(error.value)


async def test_missing_credentials_do_not_make_http_request(monkeypatch):
    def unexpected(**kwargs):
        pytest.fail("No network request should be made without configured credentials")

    monkeypatch.setattr(sms.httpx, "AsyncClient", unexpected)
    with pytest.raises(sms.SmsError):
        await sms.send_sms(settings(spug_sms_template_code=""), "13800138000", "123456")


@pytest.mark.parametrize(("detail", "expected"), [
    ("请先完成实名认证", "实名认证"),
    ("短信额度不足", "额度不足"),
    ("模板编码无效", "模板配置无效"),
    ("请求 IP 不在白名单", "IP 白名单"),
])
async def test_spug_rejection_explains_known_configuration_blockers_safely(monkeypatch, detail, expected):
    real_client = httpx.AsyncClient
    transport = httpx.MockTransport(lambda _: httpx.Response(200, json={"code": 400, "msg": detail + " test-template-code"}))
    monkeypatch.setattr(sms.httpx, "AsyncClient", lambda **kw: real_client(transport=transport, **kw))
    with pytest.raises(sms.SmsError) as error:
        await sms.send_sms(settings(), "13800138000", "123456")
    assert expected in str(error.value)
    assert "test-template-code" not in str(error.value)


def test_spug_settings_read_backend_environment(monkeypatch):
    from opentalking.core.config import Settings
    monkeypatch.setenv("OPENTALKING_SMS_PROVIDER", "spug")
    monkeypatch.setenv("OPENTALKING_SPUG_SMS_TEMPLATE_CODE", "env-test-code")
    config = Settings(_env_file=None)
    assert config.sms_provider == "spug"
    assert config.spug_sms_template_code == "env-test-code"


def test_invalid_provider_is_configuration_error(monkeypatch):
    from opentalking.core.config import Settings
    monkeypatch.setenv("OPENTALKING_SMS_PROVIDER", "unknown")
    with pytest.raises(ValueError):
        Settings(_env_file=None)
