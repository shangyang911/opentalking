import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RuntimeConfigWorkspace } from "../src/features/settings/RuntimeConfigWorkspace";
import type { RuntimeConfigResponse } from "../src/features/settings/api";

function render(provider: string, loading = false): string {
  const config: RuntimeConfigResponse = {
    llm: { base_url: "https://example.test/v1", model: "demo-llm", api_key_set: true },
    stt: { provider: "dashscope", enabled_providers: ["dashscope"], base_url: "", model: "demo-asr", api_key_set: true, service_url_set: true },
    tts: { provider, enabled_providers: ["edge", "dashscope", "cosyvoice"], base_url: "", model: "demo-tts", voice: "saved-voice", api_key_set: true, service_url_set: true },
  };
  return renderToStaticMarkup(createElement(RuntimeConfigWorkspace, {
    runtimeConfig: config, runtimeConfigLoading: loading,
    onRuntimeConfigRefresh: () => undefined, onRuntimeConfigApply: async () => undefined,
  }));
}

test("configuration displays the saved provider models and voice", () => {
  const html = render("dashscope");
  for (const value of ["demo-llm", "demo-asr", "demo-tts", "saved-voice"]) {
    assert.ok(html.includes(`value="${value}"`));
  }
  assert.match(html, /LLM · OpenAI 兼容/);
  assert.match(html, /STT · 百炼 DashScope/);
  assert.match(html, /TTS · 语音合成/);
});

test("saved credential status never populates password inputs", () => {
  const inputs = render("cosyvoice").match(/<input[^>]+type="password"[^>]*>/g) ?? [];
  assert.equal(inputs.length, 3);
  for (const input of inputs) assert.match(input, /value=""/);
});

test("Edge requires no TTS key while hosted speech providers expose one", () => {
  assert.equal((render("edge").match(/type="password"/g) ?? []).length, 2);
  assert.equal((render("dashscope").match(/type="password"/g) ?? []).length, 3);
  assert.equal((render("cosyvoice").match(/type="password"/g) ?? []).length, 3);
  assert.match(render("edge"), /无需 API Key/);
});

test("loading disables configuration changes and apply", () => {
  const html = render("edge", true);
  assert.match(html, /<fieldset[^>]*disabled/);
  assert.match(html, /<button[^>]*disabled[^>]*>应用配置/);
});
