import { apiGet, apiPost } from "../../shared/api/client";

export type RuntimeConfigLlm = {
  base_url: string;
  model: string;
  api_key_set: boolean;
};

export type RuntimeConfigStt = {
  provider: string;
  enabled_providers: string[];
  base_url: string;
  model: string;
  api_key_set: boolean;
  service_url_set: boolean;
};

export type RuntimeConfigTts = {
  provider: string;
  enabled_providers: string[];
  base_url: string;
  model: string;
  voice: string;
  api_key_set: boolean;
  service_url_set: boolean;
};

export type RuntimeConfigResponse = {
  llm: RuntimeConfigLlm;
  stt: RuntimeConfigStt;
  tts: RuntimeConfigTts;
  applied?: boolean;
  requires_new_session?: boolean;
  live_runners_refreshed?: number;
};

export type RuntimeConfigApplyInput = {
  llm_base_url?: string;
  llm_model?: string;
  llm_api_key?: string;
  stt_provider?: string;
  stt_base_url?: string;
  stt_model?: string;
  stt_api_key?: string;
  tts_provider?: string;
  tts_base_url?: string;
  tts_model?: string;
  tts_voice?: string;
  tts_api_key?: string;
  sync_dashscope_api_key?: boolean;
};

export async function loadRuntimeConfig(): Promise<RuntimeConfigResponse> {
  return apiGet<RuntimeConfigResponse>("/runtime-config");
}

export async function applyRuntimeConfig(input: RuntimeConfigApplyInput): Promise<RuntimeConfigResponse> {
  return apiPost<RuntimeConfigResponse>("/runtime-config/apply", input);
}
