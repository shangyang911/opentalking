import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TopBar } from "../src/app/TopBar";
import type { ConnectionStatus } from "../src/shared/types";

test("connected sessions expose an explicit end-conversation action in every workflow", () => {
  for (const connection of ["live", "expiring"] as const) {
    for (const workflow of ["realtime", "videoCreation", "assetLibrary", "runtimeConfig"] as const) {
      const html = renderToStaticMarkup(createElement(TopBar, {
        connection, workflow, onEndSession: () => undefined,
      }));
      assert.match(html, /<button[^>]*>结束对话<\/button>/);
    }
  }
});

test("inactive sessions do not offer an end-conversation action", () => {
  for (const connection of ["idle", "connecting", "queued", "error"] as ConnectionStatus[]) {
    const html = renderToStaticMarkup(createElement(TopBar, { connection, onEndSession: () => undefined }));
    assert.doesNotMatch(html, /结束对话/);
  }
});

test("ending a session disables the end action and reports progress", () => {
  const html = renderToStaticMarkup(createElement(TopBar, {
    connection: "live", sessionEnding: true, onEndSession: () => undefined,
  }));
  assert.match(html, /<button[^>]*disabled[^>]*>结束中…<\/button>/);
});
