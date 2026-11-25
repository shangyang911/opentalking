import type { TtsProviderExtended } from "./constants/ttsBailian";
import { QWEN_TTS_MODEL_OPTIONS, QWEN_TTS_VOICE_OPTIONS } from "./constants/ttsQwen";

export const VOICE_CLONE_MODEL = "qwen-audio-3.1-tts-flash";
export type ClonedVoice = {
  id: number;
  provider: "cosyvoice";
  voice_id: string;
  display_label: string;
  target_model: string;
  source: "clone";
};

export function voiceOptionsForProvider(provider: TtsProviderExtended, voices: ClonedVoice[]) {
  return provider === "cosyvoice"
    ? voices.map((voice) => ({ id: voice.voice_id, label: voice.display_label, targetModel: voice.target_model }))
    : QWEN_TTS_VOICE_OPTIONS;
}

export function voiceModelsForProvider(provider: TtsProviderExtended, voices: ClonedVoice[]) {
  return provider === "cosyvoice"
    ? [...new Set([VOICE_CLONE_MODEL, ...voices.map((voice) => voice.target_model)])]
      .map((id) => ({ id, label: id === VOICE_CLONE_MODEL ? "专属声音 · 百炼 Qwen" : id }))
    : QWEN_TTS_MODEL_OPTIONS;
}
