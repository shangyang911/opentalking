from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx
from opentalking.core.metering import current_meter


class OpenAICompatibleLLMClient:
    """Async streaming client for OpenAI-compatible chat completion APIs."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str = "qwen-turbo",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model

    async def chat_stream(self, messages: list[dict[str, str]]) -> AsyncIterator[str]:
        if not self.base_url:
            raise RuntimeError("LLM base_url is not configured")

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {"model": self.model, "messages": messages, "stream": True}
        meter = current_meter.get()
        if meter:
            if sum(len(message.get('content') or '') for message in messages) > 12000:
                raise ValueError('本次对话上下文过长，请结束后重新开始。')
            meter.check_deadline()
            payload['stream_options'] = {'include_usage': True}
            payload['max_tokens'] = getattr(meter.settings, 'billing_llm_max_tokens', 512)
        timeout = httpx.Timeout(connect=60.0, read=120.0, write=30.0, pool=30.0)
        url = f"{self.base_url}/chat/completions"

        usage = None
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as response:
                    response.raise_for_status()
                    async for raw_line in response.aiter_lines():
                        line = raw_line.strip()
                        if not line or not line.startswith("data:"):
                            continue
                        data = line[len("data:") :].strip()
                        if data == "[DONE]":
                            return
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        reported = chunk.get('usage')
                        if isinstance(reported, dict) and all(isinstance(reported.get(k), int) and reported[k] >= 0 for k in ('prompt_tokens', 'completion_tokens')):
                            usage = dict(input_tokens=reported['prompt_tokens'], output_tokens=reported['completion_tokens'])
                        choices = chunk.get("choices", [])
                        if not choices:
                            continue
                        delta = choices[0].get("delta", {})
                        content = delta.get("content")
                        if content:
                            yield content
        finally:
            if meter:
                await meter.emit('llm', self.model, usage or {}, usage is not None)
