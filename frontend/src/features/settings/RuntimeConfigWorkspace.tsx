import { useEffect, useState, type ReactNode } from "react";
import type { RuntimeConfigApplyInput, RuntimeConfigResponse } from "./api";

type TtsProvider = "edge" | "dashscope" | "cosyvoice";

const TTS_DEFAULTS = {
  edge: { model: "", voice: "zh-CN-XiaoxiaoNeural" },
  dashscope: { model: "qwen3-tts-flash-realtime", voice: "Cherry" },
  cosyvoice: { model: "qwen-audio-3.1-tts-flash", voice: "" },
};

type RuntimeConfigForm = {
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  sttModel: string;
  sttApiKey: string;
  ttsProvider: TtsProvider;
  ttsModel: string;
  ttsVoice: string;
  ttsApiKey: string;
};

function runtimeFormFromConfig(config: RuntimeConfigResponse | null): RuntimeConfigForm {
  const ttsProvider = config?.tts.provider === "cosyvoice" ? "cosyvoice" : config?.tts.provider === "edge" ? "edge" : "dashscope";
  const ttsMatches = config?.tts.provider === ttsProvider;
  return {
    llmBaseUrl: config?.llm.base_url || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    llmModel: config?.llm.model || "qwen-flash",
    llmApiKey: "",
    sttModel: config?.stt.provider === "dashscope" && config.stt.model ? config.stt.model : "paraformer-realtime-v2",
    sttApiKey: "",
    ttsProvider,
    ttsModel: ttsMatches && config.tts.model ? config.tts.model : TTS_DEFAULTS[ttsProvider].model,
    ttsVoice: ttsMatches && config.tts.voice ? config.tts.voice : TTS_DEFAULTS[ttsProvider].voice,
    ttsApiKey: "",
  };
}

export interface RuntimeConfigWorkspaceProps {
  runtimeConfig: RuntimeConfigResponse | null;
  runtimeConfigLoading?: boolean;
  runtimeConfigApplying?: boolean;
  onRuntimeConfigRefresh: () => void;
  onRuntimeConfigApply: (input: RuntimeConfigApplyInput) => Promise<void>;
}

function ConfigSection({ title, keySet, needsKey = true, children }: {
  title: string;
  keySet: boolean;
  needsKey?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${keySet || !needsKey ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          {needsKey ? keySet ? "Key 已设置" : "Key 未设置" : "无需 API Key"}
        </span>
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

export function RuntimeConfigWorkspace({
  runtimeConfig,
  runtimeConfigLoading = false,
  runtimeConfigApplying = false,
  onRuntimeConfigRefresh,
  onRuntimeConfigApply,
}: RuntimeConfigWorkspaceProps) {
  const [runtimeForm, setRuntimeForm] = useState(() => runtimeFormFromConfig(runtimeConfig));

  useEffect(() => {
    if (runtimeConfig) setRuntimeForm(runtimeFormFromConfig(runtimeConfig));
  }, [runtimeConfig]);

  const updateRuntimeForm = <K extends keyof RuntimeConfigForm>(key: K, value: RuntimeConfigForm[K]) => {
    setRuntimeForm((prev) => ({ ...prev, [key]: value }));
  };

  const selectTtsProvider = (provider: TtsProvider) => {
    const matchesSaved = runtimeConfig?.tts.provider === provider;
    setRuntimeForm((prev) => ({
      ...prev,
      ttsProvider: provider,
      ttsModel: matchesSaved && runtimeConfig.tts.model ? runtimeConfig.tts.model : TTS_DEFAULTS[provider].model,
      ttsVoice: matchesSaved && runtimeConfig.tts.voice ? runtimeConfig.tts.voice : TTS_DEFAULTS[provider].voice,
      ttsApiKey: "",
    }));
  };

  const handleRuntimeApply = async () => {
    const payload: RuntimeConfigApplyInput = {
      llm_base_url: runtimeForm.llmBaseUrl.trim(),
      llm_model: runtimeForm.llmModel.trim(),
      stt_provider: "dashscope",
      stt_base_url: "https://dashscope.aliyuncs.com",
      stt_model: runtimeForm.sttModel.trim(),
      tts_provider: runtimeForm.ttsProvider,
      tts_voice: runtimeForm.ttsVoice.trim(),
      sync_dashscope_api_key: false,
    };
    if (runtimeForm.llmApiKey.trim()) payload.llm_api_key = runtimeForm.llmApiKey.trim();
    if (runtimeForm.sttApiKey.trim()) payload.stt_api_key = runtimeForm.sttApiKey.trim();
    if (runtimeForm.ttsProvider === "dashscope") {
      payload.tts_base_url = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
      payload.tts_model = runtimeForm.ttsModel.trim();
      if (runtimeForm.ttsApiKey.trim()) payload.tts_api_key = runtimeForm.ttsApiKey.trim();
    }
    if (runtimeForm.ttsProvider === "cosyvoice") {
      payload.tts_model = runtimeForm.ttsModel.trim();
      if (runtimeForm.ttsApiKey.trim()) payload.tts_api_key = runtimeForm.ttsApiKey.trim();
    }
    await onRuntimeConfigApply(payload);
    setRuntimeForm((prev) => ({ ...prev, llmApiKey: "", sttApiKey: "", ttsApiKey: "" }));
  };

  const busy = runtimeConfigLoading || runtimeConfigApplying;
  const llmKeySet = Boolean(runtimeConfig?.llm.api_key_set || runtimeForm.llmApiKey.trim());
  const sttKeySet = Boolean((runtimeConfig?.stt.provider === "dashscope" && runtimeConfig.stt.api_key_set) || runtimeForm.sttApiKey.trim());
  const ttsKeySet = Boolean((["dashscope", "cosyvoice"].includes(runtimeConfig?.tts.provider ?? "") && runtimeConfig?.tts.api_key_set) || runtimeForm.ttsApiKey.trim());
  const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition focus:border-cyan-300";
  const keyPlaceholder = "留空保留已保存的 Key";

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-slate-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 lg:p-6">
        <fieldset disabled={busy} className="grid min-w-0 gap-4 disabled:opacity-70 lg:grid-cols-2">
          <ConfigSection title="LLM · OpenAI 兼容" keySet={llmKeySet}>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Base URL</span>
              <input value={runtimeForm.llmBaseUrl} onChange={(event) => updateRuntimeForm("llmBaseUrl", event.target.value)} className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">模型</span>
              <input value={runtimeForm.llmModel} onChange={(event) => updateRuntimeForm("llmModel", event.target.value)} className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">API Key</span>
              <input type="password" value={runtimeForm.llmApiKey} onChange={(event) => updateRuntimeForm("llmApiKey", event.target.value)} autoComplete="new-password" placeholder={keyPlaceholder} className={inputClass} />
            </label>
          </ConfigSection>
          <ConfigSection title="STT · 百炼 DashScope" keySet={sttKeySet}>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">模型</span>
              <input value={runtimeForm.sttModel} onChange={(event) => updateRuntimeForm("sttModel", event.target.value)} className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">API Key</span>
              <input type="password" value={runtimeForm.sttApiKey} onChange={(event) => updateRuntimeForm("sttApiKey", event.target.value)} autoComplete="new-password" placeholder={keyPlaceholder} className={inputClass} />
            </label>
          </ConfigSection>
          <ConfigSection title="TTS · 语音合成" keySet={ttsKeySet} needsKey={runtimeForm.ttsProvider !== "edge"}>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">语音服务</span>
              <select value={runtimeForm.ttsProvider} onChange={(event) => selectTtsProvider(event.target.value as TtsProvider)} className={inputClass}>
                <option value="edge">Edge</option>
                <option value="dashscope">百炼 Qwen</option>
                <option value="cosyvoice">专属声音 · 百炼</option>
              </select>
            </label>
            {runtimeForm.ttsProvider !== "edge" ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">模型</span>
                  <input value={runtimeForm.ttsModel} onChange={(event) => updateRuntimeForm("ttsModel", event.target.value)} className={inputClass} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">API Key</span>
                  <input type="password" value={runtimeForm.ttsApiKey} onChange={(event) => updateRuntimeForm("ttsApiKey", event.target.value)} autoComplete="new-password" placeholder={keyPlaceholder} className={inputClass} />
                </label>
              </>
            ) : null}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">默认音色</span>
              <input value={runtimeForm.ttsVoice} onChange={(event) => updateRuntimeForm("ttsVoice", event.target.value)} className={inputClass} />
            </label>
            <p className="text-xs leading-5 text-slate-500">实时对话中可选择音色并试听。</p>
          </ConfigSection>
        </fieldset>
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60">
          <button type="button" onClick={onRuntimeConfigRefresh} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-50">{runtimeConfigLoading ? "读取中" : "刷新"}</button>
          <button type="button" onClick={() => void handleRuntimeApply()} disabled={busy} className="rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">{runtimeConfigApplying ? "应用中..." : "应用配置"}</button>
        </div>
      </div>
    </main>
  );
}
