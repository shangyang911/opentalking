import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeSessionFields } from "../src/features/knowledge/config";

test("knowledge config never silently binds a default library", () => {
  const fields = knowledgeSessionFields([], false);
  assert.equal(fields.agent_enabled, false);
  assert.equal(fields.knowledge_enabled, false);
  assert.deepEqual(fields.knowledge_base_ids, []);
});

test("selected libraries and explicit memory survive session creation", () => {
  const fields = knowledgeSessionFields(["kb-a", "kb-a", "", "kb-b"], true);
  assert.deepEqual(fields.knowledge_base_ids, ["kb-a", "kb-b"]);
  assert.equal(fields.memory_mode, "explicit");
  assert.equal(fields.memory_enabled, true);
  assert.equal(fields.agent_enabled, true);
});
