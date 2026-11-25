import { apiPostBlob } from "../../shared/api/client";
import type { TtsProviderExtended } from "./constants/ttsBailian";

export const DEFAULT_TTS_PREVIEW_TEXT = "你好，我正在测试音色。";

export type TTSPreviewPayload = {
  text: string;
  voice?: string;
  tts_provider: TtsProviderExtended;
  tts_model?: string;
};

export function buildTTSPreviewPayload({ text, voice, provider, model }: {
  text: string;
  voice?: string;
  provider: TtsProviderExtended;
  model?: string;
}): TTSPreviewPayload {
  return {
    text: text.trim(),
    tts_provider: provider,
    ...(voice?.trim() ? { voice: voice.trim() } : {}),
    ...(provider !== "edge" && model?.trim() ? { tts_model: model.trim() } : {}),
  };
}

export async function requestTTSPreview(payload: TTSPreviewPayload): Promise<Blob> {
  return apiPostBlob("/tts/preview", payload);
}
