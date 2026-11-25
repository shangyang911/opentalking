import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { uploadMaterial } from "../src/features/knowledge/api";
import { knowledgeSettingsChanged, knowledgeSettingsKey, parseKnowledgeSettings, availableKnowledgeIds, materialStatus } from "../src/features/knowledge/config";
import { SessionKnowledgeStatus } from "../src/features/knowledge/SessionKnowledgeStatus";

test("the first valid upload creates My materials without a separate create step", async () => {
  const previous = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path.endsWith("/knowledge/bases")) {
      assert.equal(JSON.parse(String(init?.body)).name, "我的资料");
      return Response.json({ id: "kb-first", name: "我的资料", document_count: 0 });
    }
    return Response.json({ id: "doc-1", status: "uploaded", filename: "menu.txt" });
  };
  try {
    const result = await uploadMaterial(new File(["清淡菜品"], "menu.txt"), "", []);
    assert.equal(result.base.id, "kb-first");
    assert.equal(result.document.id, "doc-1");
    assert.deepEqual(paths, ["/api/knowledge/bases", "/api/knowledge/bases/kb-first/documents"]);
  } finally { globalThis.fetch = previous; }
});

test("later uploads reuse a selected group instead of creating another default", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async input => {
    assert.match(String(input), /\/knowledge\/bases\/kb-existing\/documents$/);
    return Response.json({ id: "doc-2", status: "uploaded" });
  };
  try {
    const result = await uploadMaterial(new File(["内容"], "notes.md"), "kb-existing", [{ id: "kb-existing", name: "课程笔记", document_count: 1 }]);
    assert.equal(result.base.id, "kb-existing");
  } finally { globalThis.fetch = previous; }
});

test("an interrupted first upload retains its group so retry does not create another", async () => {
  const previous = globalThis.fetch;
  const bases: { id: string; name: string; document_count: number }[] = [];
  let creates = 0;
  let uploads = 0;
  globalThis.fetch = async input => {
    if (String(input).endsWith("/knowledge/bases")) {
      creates++;
      return Response.json({ id: "created-before-interruption", name: "我的资料", document_count: 0 });
    }
    if (++uploads === 1) throw new Error("connection lost");
    return Response.json({ id: "doc-retried", status: "uploaded" });
  };
  try {
    await assert.rejects(uploadMaterial(new File(["内容"], "notes.md"), "", bases, base => bases.push(base)), /connection lost/);
    const result = await uploadMaterial(new File(["内容"], "notes.md"), "", bases);
    assert.equal(creates, 1);
    assert.equal(result.document.id, "doc-retried");
  } finally { globalThis.fetch = previous; }
});

test("unsupported or empty uploads do not create a group", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { assert.fail("invalid upload must not write to the server"); };
  try {
    await assert.rejects(uploadMaterial(new File(["x"], "image.exe"), "", []), /支持/);
    await assert.rejects(uploadMaterial(new File([], "empty.txt"), "", []), /为空/);
  } finally { globalThis.fetch = previous; }
});

test("session differences ignore ordering but detect pending memory and group changes", () => {
  assert.equal(knowledgeSettingsChanged({ ids: ["a", "b"], memoryEnabled: true }, ["b", "a"], true), false);
  assert.equal(knowledgeSettingsChanged({ ids: ["a"], memoryEnabled: false }, ["b"], true), true);
});

test("readable document status distinguishes usable passages from processing failure", () => {
  assert.equal(materialStatus({ status: "uploaded", index_error: null }), "正在阅读资料");
  assert.equal(materialStatus({ status: "ready_fast", index_error: null }), "可以提问");
  assert.equal(materialStatus({ status: "error", index_error: "failed" }), "阅读失败，请重试");
});

test("chat displays the active settings separately from pending settings", () => {
  const html = renderToStaticMarkup(createElement(SessionKnowledgeStatus, {
    applied: { ids: [], memoryEnabled: false }, selectedIds: ["a"], memoryEnabled: true,
    live: true, onManage: () => undefined, onReconnect: () => undefined,
  }));
  assert.match(html, /本次对话：未启用资料/);
  assert.match(html, /个人记忆未开启/);
  assert.match(html, /设置已保存，重新连接后生效/);
  assert.match(html, /重新连接并应用/);
});

test("saved settings have account-specific keys and reject malformed data", () => {
  assert.notEqual(knowledgeSettingsKey(11), knowledgeSettingsKey(22));
  assert.deepEqual(parseKnowledgeSettings('{"ids":["a","a",3,""],"memoryEnabled":true}'), { ids: ["a"], memoryEnabled: true });
  assert.deepEqual(parseKnowledgeSettings("invalid"), { ids: [], memoryEnabled: false });
});

test("saved selections drop groups deleted since the previous visit", () => {
  assert.deepEqual(availableKnowledgeIds(["removed", "still-owned"], [{ id: "still-owned" }]), ["still-owned"]);
});

test("reconnection stays disabled during a recording and tells the user why", () => {
  const html = renderToStaticMarkup(createElement(SessionKnowledgeStatus, {
    applied: { ids: [], memoryEnabled: false }, selectedIds: ["a"], memoryEnabled: true,
    live: true, onManage: () => undefined, onReconnect: () => undefined,
    reconnectDisabled: true, reconnectReason: "请先停止并保存录制，再重新连接。",
  }));
  assert.match(html, /<button[^>]*disabled[^>]*>重新连接并应用<\/button>/);
  assert.match(html, /请先停止并保存录制/);
});
