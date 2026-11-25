import assert from "node:assert/strict";
import test from "node:test";
import { buildTTSPreviewPayload } from "../src/features/voices/ttsPreview";
import { apiDelete } from "../src/shared/api/client";
import { voiceOptionsForProvider, voiceModelsForProvider, type ClonedVoice } from "../src/features/voices/voiceClone";

const familiar: ClonedVoice = {
  id: 501, provider: "cosyvoice", voice_id: "cosyvoice-familiar",
  display_label: "熟悉的声音", target_model: "qwen-audio-3.1-tts-flash", source: "clone",
};

test("cloned voice selection preserves its synthesis model in previews", () => {
  assert.deepEqual(buildTTSPreviewPayload({
    text: " 陪你聊聊今天的事。 ", provider: "cosyvoice", voice: familiar.voice_id, model: familiar.target_model,
  }), {
    text: "陪你聊聊今天的事。", tts_provider: "cosyvoice", voice: familiar.voice_id, tts_model: "qwen-audio-3.1-tts-flash",
  });
});

test("saved clone labels and model bindings are kept separate from standard Qwen voices", () => {
  const voices = voiceOptionsForProvider("cosyvoice", [familiar]);
  assert.deepEqual(voices, [{ id: familiar.voice_id, label: "熟悉的声音", targetModel: familiar.target_model }]);
  assert.equal(voiceOptionsForProvider("dashscope", [familiar]).some((voice) => voice.id === familiar.voice_id), false);
  assert.deepEqual(voiceModelsForProvider("cosyvoice", [familiar]).map((model) => model.id), [familiar.target_model]);
  assert.deepEqual(voiceOptionsForProvider("cosyvoice", []), []);
});

test("deleting a saved voice accepts the API's empty 204 response", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  try {
    assert.equal(await apiDelete("/voices/501"), undefined);
  } finally {
    globalThis.fetch = original;
  }
});
