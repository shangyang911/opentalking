import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginPage } from "../src/features/auth/LoginPage";
import { TopBar } from "../src/app/TopBar";
import { apiGet, apiPost, buildApiUrl, setApiAccount } from "../src/shared/api/client";
import { uploadExportVideo } from "../src/features/works/api";

test("shared endpoints select the portal of the current tab", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const portals: (string | null)[] = [];
  globalThis.fetch = async (_input, init) => {
    portals.push(new Headers(init?.headers).get("X-Opentalking-Portal"));
    return new Response("{}");
  };
  try {
    Object.assign(globalThis, { window: { location: { pathname: "/admin", href: "https://studio.example/admin" } } });
    await apiGet("/auth/me");
    await apiPost("/auth/logout");
    await apiPost("/runtime-config/apply");
    Object.assign(globalThis, { window: { location: { pathname: "/", href: "https://studio.example/" } } });
    await apiGet("/auth/me");
    await apiPost("/auth/logout");
    assert.deepEqual(portals, ["admin", "admin", "admin", "user", "user"]);
  } finally {
    globalThis.fetch = previousFetch;
    Object.assign(globalThis, { window: previousWindow });
  }
});

test("a delayed recording upload retains its originating account after another tab logs in", async () => {
  const previous = globalThis.fetch;
  let received: Headers | null = null;
  globalThis.fetch = async (_input, init) => { received = new Headers(init?.headers); return new Response("{}"); };
  try {
    setApiAccount(22);
    await uploadExportVideo({ blob: new Blob(["recording"], { type: "video/webm" }), kind: "realtime_dialogue", title: "old recording", accountId: 11 });
    assert.equal((received as Headers | null)?.get("X-Opentalking-Account"), "11");
  } finally { setApiAccount(null); globalThis.fetch = previous; }
});

test("requests carry the displayed account so stale tabs cannot upload into a new account", async () => {
  const previous = globalThis.fetch;
  let received: Headers | null = null;
  globalThis.fetch = async (_input, init) => { received = new Headers(init?.headers); return new Response("{}"); };
  try {
    setApiAccount(42);
    await apiPost("/exports/videos");
    assert.equal((received as Headers | null)?.get("X-Opentalking-Account"), "42");
  } finally { setApiAccount(null); globalThis.fetch = previous; }
});

test("admin URLs with trailing slashes keep using the root API proxy", () => {
  const previous = globalThis.window;
  Object.assign(globalThis, { window: { location: { href: "https://studio.example/admin/", origin: "https://studio.example" } } });
  try { assert.equal(buildApiUrl("/auth/me"), "https://studio.example/api/auth/me"); }
  finally { Object.assign(globalThis, { window: previous }); }
});

test("HTTP helpers send the session cookie on reads and writes", async () => {
  const previous = globalThis.fetch;
  const requests: RequestInit[] = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await apiGet("/auth/me"); await apiPost("/auth/logout");
    assert.equal(requests[0].credentials, "include");
    assert.equal(requests[1].credentials, "include");
  } finally { globalThis.fetch = previous; }
});

test("admin login offers password sign in without public registration", () => {
  const html = renderToStaticMarkup(createElement(LoginPage, { admin: true, smsReady: true, onLogin() {} }));
  assert.match(html, /autoComplete="current-password"/i);
  assert.doesNotMatch(html, /登录 \/ 注册|获取验证码/);
});

test("user top bar offers logout and hides administrator configuration", () => {
  const html = renderToStaticMarkup(createElement(TopBar, { connection: "idle", canManageSettings: false, onLogout() {} }));
  assert.match(html, /退出登录/);
  assert.doesNotMatch(html, /打开 API 配置设置/);
});

test("user registration sets a password and offers a simple existing-account link", () => {
  const html = renderToStaticMarkup(createElement(LoginPage, { admin: false, smsReady: true, onLogin() {} }));
  assert.match(html, /已注册/);
  assert.match(html, /账号密码登录/);
  assert.match(html, /name="phone"/);
  assert.match(html, /autoComplete="new-password"/i);
  assert.match(html, /确认密码/);
  assert.doesNotMatch(html, /测试账号|aria-label="登录方式"|border-t/);
});
