import { useEffect, useState, type ReactNode } from "react";
import type { AvatarSummary } from "../avatars/api";
import { modelLabel } from "../avatars/modelLabels";
import { modelConnectionBadge, type ModelStatus } from "../avatars/modelStatus";
import { isDogoLight2dAvatar } from "../avatars/avatarSelection";
import type { TtsProviderExtended } from "../voices/constants/ttsBailian";
import { VoiceClonePanel, type VoiceClonePanelProps } from "../voices/components/VoiceClonePanel";

export const SETTINGS_DOCK_EXPANDED_KEY = "opentalking-settings-dock-expanded";
const TTS_PREVIEW_TEXT_MAX_CHARS = 1000;

export interface SettingsPanelProps {
  membershipLabel?: string;
  onMembership?: () => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  avatars: AvatarSummary[];
  models: string[];
  modelStatuses: ModelStatus[];
  avatarId: string;
  model: string;
  modelConnected: boolean;
  onModelChange: (model: string) => void;
  edgeVoice: string;
  onEdgeVoiceChange: (voiceId: string) => void;
  edgeVoiceOptions: { id: string; label: string }[];
  ttsProvider: TtsProviderExtended;
  onTtsProviderChange: (provider: TtsProviderExtended) => void;
  qwenModel: string;
  onQwenModelChange: (modelId: string) => void;
  qwenModelOptions: { id: string; label: string }[];
  qwenVoice: string;
  onQwenVoiceChange: (voiceId: string) => void;
  qwenVoiceOptions: { id: string; label: string; targetModel?: string | null }[];
  ttsPreviewText: string;
  onTtsPreviewTextChange: (value: string) => void;
  onPreviewTts: () => void;
  ttsPreviewing?: boolean;
  asrModel: string;
  configLocked?: boolean;
  voiceCloneProps: VoiceClonePanelProps;
}

function SettingsSection({ id, title, children, open, onToggle }: {
  id: string;
  title: string;
  children: ReactNode;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/40">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <button
          type="button"
          onClick={() => onToggle(id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          aria-controls={`settings-section-${id}`}
        >
          <svg className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M7 4l6 6-6 6V4z" />
          </svg>
          <h3 className="truncate text-sm font-semibold text-slate-900">{title}</h3>
        </button>
      </div>
      {open ? <div id={`settings-section-${id}`} className="p-4">{children}</div> : null}
    </section>
  );
}

export function SettingsPanel({
  membershipLabel,
  onMembership,
  expanded,
  onExpandedChange,
  avatars,
  models,
  modelStatuses,
  avatarId,
  model,
  modelConnected,
  onModelChange,
  edgeVoice,
  onEdgeVoiceChange,
  edgeVoiceOptions,
  ttsProvider,
  onTtsProviderChange,
  qwenModel,
  onQwenModelChange,
  qwenModelOptions,
  qwenVoice,
  onQwenVoiceChange,
  qwenVoiceOptions,
  ttsPreviewText,
  onTtsPreviewTextChange,
  onPreviewTts,
  ttsPreviewing = false,
  asrModel,
  configLocked = false,
  voiceCloneProps,
}: SettingsPanelProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    avatars: true,
    model: true,
    asr: true,
    voice: true,
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && expanded) onExpandedChange(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [expanded, onExpandedChange]);

  const toggleSection = (id: string) => setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  const currentAvatar = avatars.find((avatar) => avatar.id === avatarId) ?? null;
  const dogoLightModeLocked = isDogoLight2dAvatar(currentAvatar);
  const modelStatusById = new Map(modelStatuses.map((status) => [status.id, status]));
  const voiceOptions = ttsProvider === "edge" ? edgeVoiceOptions : qwenVoiceOptions;
  const selectedVoice = ttsProvider === "edge" ? edgeVoice : qwenVoice;
  const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-slate-50/70 lg:h-full lg:w-[360px] lg:shrink-0 lg:overflow-hidden">
      <div className="shrink-0 p-4 pb-3">
        <p className="text-xs font-medium text-slate-500">当前工作流</p>
        <h2 className="text-lg font-semibold text-slate-950">实时对话</h2>
      </div>
      <div className="space-y-4 p-4 pt-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <SettingsSection id="avatars" title="数字人形象" open={openSections.avatars} onToggle={toggleSection}>
          {currentAvatar ? (
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
              <p className="truncate text-sm font-semibold text-slate-950">{currentAvatar.name ?? currentAvatar.id}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">启动前可在中间区域查看照片并切换数字人形象。</p>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">正在读取数字人资产...</p>
          )}
        </SettingsSection>
        <SettingsSection id="model" title="驱动模型" open={openSections.model} onToggle={toggleSection}>
          <div className="space-y-2">
            {models.filter((id) => id === "quicktalk" || id === "mock").map((id) => {
              const badge = modelConnectionBadge(modelStatusById.get(id), id === model && modelConnected);
              return (
                <button
                  key={id}
                  type="button"
                  disabled={configLocked || (dogoLightModeLocked && id !== "mock")}
                  onClick={() => onModelChange(id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${id === model ? "border-cyan-300 bg-cyan-50 text-cyan-800 shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{modelLabel(id)}</span>
                    <span className="mt-0.5 block text-xs text-slate-400">{id === "mock" ? "免 GPU / 浏览器动画" : "实时数字人驱动"}</span>
                  </span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badge.tone === "connected" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : badge.tone === "selfTest" ? "border-cyan-200 bg-cyan-50 text-cyan-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{badge.label}</span>
                </button>
              );
            })}
            {onMembership && <button type="button" onClick={onMembership} className="w-full rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-left text-xs leading-6 text-cyan-800">{membershipLabel || '查看试用额度与 VIP 权益'}<span className="block font-semibold">会员与额度 →</span></button>}
            {dogoLightModeLocked ? <p className="text-xs leading-relaxed text-cyan-700">博士小狗仅支持轻量模式；切换驱动模型前请先更换形象。</p> : null}
          </div>
        </SettingsSection>
        <SettingsSection id="asr" title="语音识别" open={openSections.asr} onToggle={toggleSection}>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">百炼 DashScope</p>
            <p className="mt-1 break-all text-sm font-semibold text-slate-900">{asrModel || "paraformer-realtime-v2"}</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">在运行配置中设置语音识别 API Key 和模型。</p>
          </div>
        </SettingsSection>
        <SettingsSection id="voice" title="语音合成" open={openSections.voice} onToggle={toggleSection}>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">语音服务</span>
              <select value={ttsProvider} onChange={(event) => onTtsProviderChange(event.target.value as TtsProviderExtended)} disabled={configLocked} className={inputClass}>
                <option value="edge">Edge</option>
                <option value="dashscope">百炼 Qwen</option>
                <option value="cosyvoice">专属声音</option>
              </select>
            </label>
            {ttsProvider === "dashscope" ? (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">语音模型</span>
                <select value={qwenModel} onChange={(event) => onQwenModelChange(event.target.value)} disabled={configLocked} className={inputClass}>
                  {qwenModelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
            ) : null}
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">音色</span>
              <select
                value={selectedVoice}
                onChange={(event) => ttsProvider === "edge" ? onEdgeVoiceChange(event.target.value) : onQwenVoiceChange(event.target.value)}
                disabled={configLocked || !voiceOptions.length}
                className={inputClass}
              >
                {voiceOptions.length ? voiceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>) : <option value="">暂无可用音色</option>}
              </select>
            </label>
            {configLocked ? <p className="text-xs leading-relaxed text-slate-500">停止当前对话后可修改模型和语音配置。</p> : null}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="block">
                <span className="mb-1.5 block text-xs text-slate-500">音色试听</span>
                <textarea value={ttsPreviewText} onChange={(event) => onTtsPreviewTextChange(event.target.value)} rows={2} maxLength={TTS_PREVIEW_TEXT_MAX_CHARS} className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-cyan-300" />
              </label>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400">{ttsPreviewText.length}/{TTS_PREVIEW_TEXT_MAX_CHARS}</span>
                <button type="button" onClick={onPreviewTts} disabled={ttsPreviewing || !ttsPreviewText.trim() || !selectedVoice} className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60">{ttsPreviewing ? "试听中..." : "试听一句"}</button>
              </div>
            </div>
            <VoiceClonePanel {...voiceCloneProps} />
          </div>
        </SettingsSection>
      </div>
    </aside>
  );
}
