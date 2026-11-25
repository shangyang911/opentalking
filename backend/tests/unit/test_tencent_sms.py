import json
from types import SimpleNamespace

import httpx
import pytest

from apps.api.modules.auth import sms


def settings():
    return SimpleNamespace(tencent_sms_secret_id="test-id", tencent_sms_secret_key="test-secret",
                           tencent_sms_sdk_app_id="1400000000", tencent_sms_sign_name="测试签名",
                           tencent_sms_template_id="123", tencent_sms_region="ap-guangzhou")


@pytest.mark.parametrize("payload", [
    {"Response": {"Error": {"Code": "AuthFailure", "Message": "secret detail"}}},
    {"Response": {"SendStatusSet": [{"Code": "FailedOperation.TemplateIncorrectOrUnapproved"}]}},
    {"Response": {"SendStatusSet": []}},
])
async def test_sms_provider_failure_is_not_treated_as_a_sent_code(monkeypatch, payload):
    real_client = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
    monkeypatch.setattr(sms.httpx, "AsyncClient", lambda **kwargs: real_client(transport=transport, **kwargs))
    with pytest.raises(sms.SmsError) as error:
        await sms.send_sms(settings(), "13800138000", "123456")
    assert "secret detail" not in str(error.value)


async def test_tencent_request_carries_phone_signature_and_one_template_parameter(monkeypatch):
    real_client = httpx.AsyncClient
    def handle(request):
        assert str(request.url) == "https://sms.tencentcloudapi.com/"
        payload = json.loads(request.content)
        assert payload["PhoneNumberSet"] == ["+8613800138000"]
        assert payload["TemplateParamSet"] == ["123456"]
        assert payload["SignName"] == "测试签名"
        assert payload["SmsSdkAppId"] == "1400000000"
        assert request.headers["X-TC-Version"] == "2021-01-11"
        assert request.headers["Authorization"].startswith("TC3-HMAC-SHA256 Credential=test-id/")
        return httpx.Response(200, json={"Response": {"SendStatusSet": [{"Code": "Ok", "PhoneNumber": "+8613800138000", "SerialNo": "test", "Fee": 1}], "RequestId": "test"}})
    monkeypatch.setattr(sms.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handle), **kwargs))
    await sms.send_sms(settings(), "13800138000", "123456")
