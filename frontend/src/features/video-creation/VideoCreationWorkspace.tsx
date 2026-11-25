import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ApiError, apiPostForm, buildApiDownloadUrl, buildApiUrl } from "../../shared/api/client";
import { createVideoCreationJob, getVideoCreationJob, stopVideoCreationJob, type VideoCreationJobResponse } from "./api";
import { type AvatarSummary } from "../avatars/api";
import { type ExportVideoItem } from "../works/api";
import { EDGE_ZH_VOICES } from "../voices/constants/edgeZhVoices";
import type { TtsProviderExtended } from "../voices/constants/ttsBailian";
import { QWEN_TTS_MODEL_OPTIONS, QWEN_TTS_VOICE_OPTIONS } from "../voices/constants/ttsQwen";
import { buildTTSPreviewPayload, requestTTSPreview } from "../voices/ttsPreview";

export type VideoCreationAudioSource = "upload" | "tts_text";
type VoiceOption = { id: string; label: string; targetModel?: string | null };
type VideoCreationWorkspaceProps = {
  avatars: AvatarSummary[];
  avatarId: string;
  models: string[];
  onAvatarChange: (id: string) => void;
  onAvatarUploaded: (avatar: AvatarSummary) => void;
  onExportCreated?: (item: ExportVideoItem) => void;
  onGoAssetLibrary?: () => void;
  onNotify?: (message: string, tone?: "info" | "success" | "error") => void;
  onBeforeGenerate?: () => Promise<boolean>;
  onBillingRefresh?: () => Promise<unknown>;
  ttsProvider: TtsProviderExtended;
  onTtsProviderChange: (provider: TtsProviderExtended) => void;
  qwenModel: string;
  onQwenModelChange: (modelId: string) => void;
  qwenModelOptions: { id: string; label: string }[];
  qwenVoice: string;
  onQwenVoiceChange: (voiceId: string) => void;
  qwenVoiceOptions: VoiceOption[];
  edgeVoice: string;
  onEdgeVoiceChange: (voiceId: string) => void;
  sessionLive?: boolean;
  onGeneratingChange?: (generating: boolean) => void;
};

const TERMINAL_STATUSES = new Set(["completed", "done", "error", "failed", "stopped", "cancelled", "canceled"]);
const STATUS_LABELS: Record<string, string> = {
  queued: "排队中", generating: "生成中", finalizing: "保存视频中", completed: "已完成", done: "已完成",
  error: "生成失败", failed: "生成失败", stopped: "已停止", cancelled: "已停止", canceled: "已停止",
};
const FIELD_CLASS = "mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-cyan-400 disabled:bg-slate-100";
function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.detail || error.message : error instanceof Error ? error.message : "请稍后重试。";
}

export function VideoCreationWorkspace(props: VideoCreationWorkspaceProps) {
  const {
    avatars, avatarId, models, onAvatarChange, onAvatarUploaded, onGoAssetLibrary,
    ttsProvider, onTtsProviderChange, qwenModel, onQwenModelChange, qwenModelOptions,
    qwenVoice, onQwenVoiceChange, qwenVoiceOptions, edgeVoice, onEdgeVoiceChange, sessionLive = false,
  } = props;
  const [audioSource, setAudioSource] = useState<VideoCreationAudioSource>("tts_text");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [text, setText] = useState("你好，欢迎来到我的数字人视频。");
  const [title, setTitle] = useState("");
  const [generating, setGenerating] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [job, setJob] = useState<VideoCreationJobResponse | null>(null);
  const [result, setResult] = useState<ExportVideoItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const generatingRef = useRef(false);
  const activeJobRef = useRef<string | null>(null);
  const callbacksRef = useRef(props);
  callbacksRef.current = props;
  const selectableAvatars = useMemo(() => avatars.filter((avatar) =>
    avatar.id === "dogo-light2d" || avatar.has_preview_video || avatar.model_type === "quicktalk",
  ), [avatars]);
  const selectedAvatar = selectableAvatars.find((avatar) => avatar.id === avatarId) ?? null;
  const uploadBaseAvatar = avatars.find((avatar) => avatar.id === avatarId && avatar.id !== "dogo-light2d")
    ?? avatars.find((avatar) => avatar.id !== "dogo-light2d");
  const model = selectedAvatar?.id === "dogo-light2d" ? "mock" : "quicktalk";
  const modelAvailable = models.includes(model);
  const realtimeBusy = sessionLive && model === "quicktalk";
  const provider = ttsProvider;
  const voice = provider === "edge" ? edgeVoice : qwenVoice;
  const ttsModels = qwenModelOptions.length ? qwenModelOptions : QWEN_TTS_MODEL_OPTIONS;
  const ttsVoices = (provider === "cosyvoice" ? qwenVoiceOptions : qwenVoiceOptions.length ? qwenVoiceOptions : QWEN_TTS_VOICE_OPTIONS)
    .filter((option: VoiceOption) => !option.targetModel || option.targetModel === qwenModel);

  const updateGenerating = useCallback((value: boolean) => {
    generatingRef.current = value;
    setGenerating(value);
    callbacksRef.current.onGeneratingChange?.(value);
    if (!value) void callbacksRef.current.onBillingRefresh?.();
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const activeJob = activeJobRef.current;
      activeJobRef.current = null;
      if (activeJob) void stopVideoCreationJob(activeJob).catch(() => undefined);
      callbacksRef.current.onGeneratingChange?.(false);
    };
  }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const applyJob = useCallback((next: VideoCreationJobResponse) => {
    if (!mountedRef.current || activeJobRef.current !== next.job_id) return;
    setJob(next);
    setError(null);
    if (!TERMINAL_STATUSES.has(next.status)) return;
    activeJobRef.current = null;
    updateGenerating(false);
    if (next.export_video) {
      setResult(next.export_video);
      callbacksRef.current.onExportCreated?.(next.export_video);
      callbacksRef.current.onNotify?.("视频已保存到作品。", "success");
    } else if (["failed", "error", "completed", "done"].includes(next.status)) {
      const message = next.error_code || "任务未返回视频，请重新生成。";
      setError(message);
      callbacksRef.current.onNotify?.(`生成失败：${message}`, "error");
    }
  }, [updateGenerating]);
  useEffect(() => {
    if (!generating || !job?.job_id) return;
    const jobId = job.job_id;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await getVideoCreationJob(jobId);
        if (cancelled || activeJobRef.current !== jobId) return;
        applyJob(next);
        if (TERMINAL_STATUSES.has(next.status)) return;
      } catch (pollError) {
        if (cancelled || activeJobRef.current !== jobId) return;
        setError(`暂时无法获取进度，正在重试：${errorMessage(pollError)}`);
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 1500);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [applyJob, generating, job?.job_id]);

  const handleGenerate = async () => {
    if (generatingRef.current || !selectedAvatar || !modelAvailable || realtimeBusy || uploading) return;
    if (props.onBeforeGenerate && !await props.onBeforeGenerate()) return;
    if (audioSource === "upload" && !audioFile) { setError("请先上传音频。"); return; }
    if (audioSource === "tts_text" && !text.trim()) { setError("请输入口播文本。"); return; }
    if (audioSource === "tts_text" && !voice.trim()) { setError("请先在实时对话中创建或选择专属声音。"); return; }
    setError(null);
    setResult(null);
    setJob(null);
    updateGenerating(true);
    try {
      const next = await createVideoCreationJob({
        model, avatarId: selectedAvatar.id, title: title.trim() || undefined, audioSource,
        audioFile: audioSource === "upload" ? audioFile : undefined,
        text: audioSource === "tts_text" ? text.trim() : undefined,
        ttsProvider: audioSource === "tts_text" ? provider : undefined,
        ttsModel: audioSource === "tts_text" && provider !== "edge" ? qwenModel : undefined,
        voice: audioSource === "tts_text" ? voice : undefined, executionMode: "async",
      });
      if (!mountedRef.current) {
        if (!TERMINAL_STATUSES.has(next.status)) void stopVideoCreationJob(next.job_id).catch(() => undefined);
        return;
      }
      activeJobRef.current = next.job_id;
      applyJob(next);
    } catch (generationError) {
      if (!mountedRef.current) return;
      const message = `生成失败：${errorMessage(generationError)}`;
      setError(message);
      callbacksRef.current.onNotify?.(message, "error");
      updateGenerating(false);
    }
  };
  const handleStop = async () => {
    const jobId = activeJobRef.current;
    if (!jobId || stopping) return;
    setStopping(true);
    try { applyJob(await stopVideoCreationJob(jobId)); }
    catch (stopError) { if (mountedRef.current) setError(`停止失败：${errorMessage(stopError)}`); }
    finally { if (mountedRef.current) setStopping(false); }
  };
  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    const baseAvatar = uploadBaseAvatar;
    if (!file || !baseAvatar || uploading || generatingRef.current) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) { setError("请上传图片或视频。"); return; }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("base_avatar_id", baseAvatar.id);
      form.set("name", file.name.replace(/\.[^.]+$/, "") || "我的数字人");
      form.set("model", "quicktalk");
      form.set("person_mode", "single");
      form.set(file.type.startsWith("video/") ? "video" : "image", file);
      const created = await apiPostForm<AvatarSummary>("/avatars/custom", form);
      if (!mountedRef.current) return;
      onAvatarUploaded(created);
      onAvatarChange(created.id);
      callbacksRef.current.onNotify?.("数字人形象已上传。", "success");
    } catch (uploadError) { if (mountedRef.current) setError(`上传失败：${errorMessage(uploadError)}`); }
    finally { if (mountedRef.current) setUploading(false); }
  };
  const handlePreview = async () => {
    if (previewing || !text.trim()) return;
    setPreviewing(true);
    setError(null);
    try {
      const blob = await requestTTSPreview(buildTTSPreviewPayload({ text, voice, provider, model: provider !== "edge" ? qwenModel : undefined }));
      if (mountedRef.current) setPreviewUrl(URL.createObjectURL(blob));
    } catch (previewError) { if (mountedRef.current) setError(`试听失败：${errorMessage(previewError)}`); }
    finally { if (mountedRef.current) setPreviewing(false); }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-100 p-4">
      <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Avatar</p>
          <h1 className="mt-1 text-lg font-semibold text-slate-950">视频创作</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">选择数字人，输入口播文本或上传音频，生成可下载的视频。</p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            {selectableAvatars.map((avatar) => (
              <button key={avatar.id} type="button" onClick={() => onAvatarChange(avatar.id)} disabled={generating || uploading}
                className={`overflow-hidden rounded-lg border text-left transition disabled:opacity-60 ${avatar.id === avatarId ? "border-cyan-500 ring-1 ring-cyan-500" : "border-slate-200 hover:border-cyan-300"}`}>
                <img src={buildApiUrl(`/avatars/${encodeURIComponent(avatar.id)}/preview`)} alt={avatar.name ?? avatar.id} className="aspect-square w-full bg-slate-100 object-cover" />
                <span className="block truncate px-2 py-2 text-xs font-semibold text-slate-700">{avatar.name ?? avatar.id}</span>
              </button>
            ))}
          </div>
          {!selectableAvatars.length ? <p className="mt-4 text-sm text-slate-500">暂无可用数字人，请检查形象配置。</p> : null}
          <button type="button" onClick={() => uploadRef.current?.click()}
            disabled={generating || uploading || !uploadBaseAvatar}
            className="mt-4 w-full rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-700 hover:bg-cyan-100 disabled:opacity-50">
            {uploading ? "上传中…" : "上传数字人图片 / 视频"}
          </button>
          <input ref={uploadRef} type="file" accept="image/*,video/*" className="hidden" onChange={(event) => void handleAvatarUpload(event)} />
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            <span className="font-semibold">驱动模型：</span>{model === "mock" ? "Mock · Dogo 动画" : "QuickTalk"}
            {!modelAvailable ? <p className="mt-1 text-amber-700">当前服务未提供此模型。</p> : null}
          </div>
        </section>
        <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Create video</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">制作数字人口播</h2>
          <fieldset disabled={generating} className="mt-5 space-y-4 disabled:opacity-70">
            <label className="block text-sm font-semibold text-slate-700">作品名称
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="为这段视频起个名字（可选）" maxLength={120} className={FIELD_CLASS} />
            </label>
            <div className="flex gap-2" aria-label="音频来源">
              {([["tts_text", "口播合成"], ["upload", "上传音频"]] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setAudioSource(id)} aria-pressed={audioSource === id}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold ${audioSource === id ? "border-cyan-400 bg-cyan-50 text-cyan-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{label}</button>
              ))}
            </div>
            {audioSource === "upload" ? (
              <label className="block rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-sm font-semibold text-slate-700">上传驱动音频
                <input type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac" onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)} className="mt-3 block w-full text-xs font-normal text-slate-600" />
                {audioFile ? <span className="mt-2 block text-xs font-normal">{audioFile.name}</span> : null}
              </label>
            ) : (
              <>
                <label className="block text-sm font-semibold text-slate-700">口播文本
                  <textarea rows={7} value={text} onChange={(event) => setText(event.target.value)} placeholder="输入数字人要说的话…" className={`${FIELD_CLASS} resize-y leading-relaxed`} />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-700">语音服务
                    <select value={provider} onChange={(event) => onTtsProviderChange(event.target.value as "edge" | "dashscope")} className={FIELD_CLASS}>
                      <option value="edge">Microsoft Edge</option><option value="dashscope">百炼 DashScope</option><option value="cosyvoice">专属声音</option>
                    </select>
                  </label>
                  {provider === "dashscope" ? <label className="text-sm font-semibold text-slate-700">语音模型
                    <select value={qwenModel} onChange={(event) => onQwenModelChange(event.target.value)} className={FIELD_CLASS}>
                      {!ttsModels.some((option) => option.id === qwenModel) && qwenModel ? <option value={qwenModel}>{qwenModel}</option> : null}
                      {ttsModels.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label> : null}
                  <label className="text-sm font-semibold text-slate-700">音色
                    <select value={voice} onChange={(event) => provider === "edge" ? onEdgeVoiceChange(event.target.value) : onQwenVoiceChange(event.target.value)} className={FIELD_CLASS}>
                      {!(provider === "edge" ? EDGE_ZH_VOICES : ttsVoices).some((option) => option.id === voice) && voice ? <option value={voice}>{voice}</option> : null}
                      {(provider === "edge" ? EDGE_ZH_VOICES : ttsVoices).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => void handlePreview()} disabled={previewing || !text.trim()} className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-700 disabled:opacity-50">{previewing ? "合成试听中…" : "试听口播"}</button>
                  {previewUrl ? <audio src={previewUrl} controls autoPlay className="h-9 max-w-full" /> : null}
                </div>
              </>
            )}
          </fieldset>
          {realtimeBusy ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">请先结束实时对话，再使用 QuickTalk 生成视频。</p> : null}
          {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void handleGenerate()} disabled={generating || uploading || !selectedAvatar || !modelAvailable || realtimeBusy}
              className="rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">{generating ? "生成中…" : "生成并保存"}</button>
            {generating && job ? <button type="button" onClick={() => void handleStop()} disabled={stopping} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">{stopping ? "停止中…" : "停止生成"}</button> : null}
            {job ? <span role="status" className="text-sm text-slate-500">{STATUS_LABELS[job.status] ?? job.status}{generating && job.generated_duration_ms ? ` · 已生成 ${(job.generated_duration_ms / 1000).toFixed(1)} 秒` : ""}</span> : null}
          </div>
          {result ? (
            <div data-testid="video-creation-result-panel" className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-xs text-slate-500">已保存到作品</p><h3 className="mt-1 font-semibold text-slate-900">{result.title}</h3></div>
                <div className="flex gap-2">
                  <a href={buildApiDownloadUrl(result.download_url)} download className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500">下载 MP4</a>
                  {onGoAssetLibrary ? <button type="button" onClick={onGoAssetLibrary} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:text-cyan-700">查看作品</button> : null}
                </div>
              </div>
              <video src={buildApiDownloadUrl(result.download_url)} controls preload="metadata" className="mt-4 max-h-[36rem] w-full rounded-lg bg-slate-950 object-contain" />
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
