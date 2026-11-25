import { useEffect, useRef, useState } from "react";
import { ApiError, apiDelete, apiPostForm } from "../../../shared/api/client";
import { buildTTSPreviewPayload, requestTTSPreview } from "../ttsPreview";
import type { ClonedVoice } from "../voiceClone";

export type VoiceClonePanelProps = {
  voices: ClonedVoice[];
  selectedVoice: string;
  locked?: boolean;
  loading?: boolean;
  loadError?: string;
  onRetry: () => void;
  onCreated: (voice: ClonedVoice) => void;
  onDeleted: (id: number) => void;
  onUse: (voice: ClonedVoice) => void;
  onBusyChange: (busy: boolean) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.detail || error.message : error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function VoiceClonePanel({ voices, selectedVoice, locked = false, loading, loadError, onRetry, onCreated, onDeleted, onUse, onBusyChange }: VoiceClonePanelProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const operation = useRef(false);
  const previewGeneration = useRef(0);

  function stopPreview() {
    previewGeneration.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopPreview(); };
  }, []);

  useEffect(() => {
    if (locked) { stopPreview(); setPreviewing(null); }
  }, [locked]);

  async function createVoice() {
    if (!file || !name.trim() || locked || operation.current) return;
    if (file.size > 10 * 1024 * 1024) { setError("录音文件不能超过 10 MB。"); return; }
    operation.current = true;
    onBusyChange(true);
    setBusy(true); setError(""); setMessage(""); stopPreview(); setPreviewing(null);
    const form = new FormData();
    form.set("audio", file);
    form.set("display_label", name.trim());
    try {
      const voice = await apiPostForm<ClonedVoice>("/voices/clone", form);
      onCreated(voice);
      if (mounted.current) {
        setName(""); setFile(null); setOpen(false);
        if (fileRef.current) fileRef.current.value = "";
        setMessage("专属声音已保存并选用，试听一下吧。");
      }
    } catch (error) {
      if (mounted.current) setError(errorMessage(error));
    } finally {
      operation.current = false;
      onBusyChange(false);
      if (mounted.current) setBusy(false);
    }
  }

  async function preview(voice: ClonedVoice) {
    if (locked || operation.current || previewing !== null) return;
    stopPreview(); setError(""); setPreviewing(voice.id);
    const generation = previewGeneration.current;
    try {
      const blob = await requestTTSPreview(buildTTSPreviewPayload({
        text: "我在这里，愿意听你说说今天的故事。", provider: "cosyvoice", voice: voice.voice_id, model: voice.target_model,
      }));
      if (!mounted.current || generation !== previewGeneration.current) return;
      audioUrlRef.current = URL.createObjectURL(blob);
      const audio = new Audio(audioUrlRef.current);
      audioRef.current = audio;
      audio.onended = () => { stopPreview(); if (mounted.current) setPreviewing(null); };
      audio.onerror = () => { stopPreview(); if (mounted.current) { setPreviewing(null); setError("音频播放失败，请重试。"); } };
      await audio.play();
    } catch (error) {
      if (generation !== previewGeneration.current) return;
      stopPreview();
      if (mounted.current) { setError(errorMessage(error)); setPreviewing(null); }
    }
  }

  async function remove(voice: ClonedVoice) {
    if (locked || operation.current) return;
    operation.current = true; onBusyChange(true); setBusy(true); setError(""); stopPreview(); setPreviewing(null);
    try {
      await apiDelete(`/voices/${voice.id}`);
      onDeleted(voice.id);
      if (mounted.current) { setDeleteId(null); setMessage("专属声音已删除。"); }
    } catch (error) {
      if (mounted.current) setError(errorMessage(error));
    } finally {
      operation.current = false;
      onBusyChange(false);
      if (mounted.current) setBusy(false);
    }
  }

  const disabled = locked || busy;
  return (
    <div className="space-y-3 rounded-lg border border-cyan-100 bg-cyan-50/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">专属声音</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">让熟悉的声音，陪你聊聊。</p>
        </div>
        <button type="button" disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open} className="shrink-0 rounded-md border border-cyan-200 bg-white px-2.5 py-2 text-xs font-semibold text-cyan-700 disabled:opacity-50">{open ? "收起" : "克隆声音"}</button>
      </div>
      {loading ? <p className="text-xs text-slate-500">正在读取专属声音…</p> : null}
      {loadError ? <p role="alert" className="text-xs text-rose-600">{loadError} <button type="button" onClick={onRetry} disabled={disabled || loading} className="underline">重新读取</button></p> : null}
      {voices.map((voice) => (
        <div key={voice.id} className="rounded-md border border-slate-200 bg-white p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-slate-800" title={voice.display_label}>{voice.display_label}</span>
            {selectedVoice === voice.voice_id ? <span className="shrink-0 text-xs text-cyan-700">已选用</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <button type="button" disabled={disabled || previewing !== null} onClick={() => void preview(voice)} className="font-semibold text-cyan-700 disabled:opacity-50">{previewing === voice.id ? "试听中…" : "试听"}</button>
            <button type="button" disabled={disabled || selectedVoice === voice.voice_id} onClick={() => { stopPreview(); setPreviewing(null); onUse(voice); setMessage(`已选用「${voice.display_label}」。`); }} className="font-semibold text-cyan-700 disabled:opacity-50">用于对话</button>
            {deleteId === voice.id ? <><button type="button" disabled={disabled} onClick={() => void remove(voice)} className="text-rose-600 disabled:opacity-50">确认删除</button><button type="button" disabled={disabled} onClick={() => setDeleteId(null)} className="text-slate-500">取消</button></> : <button type="button" disabled={disabled} onClick={() => setDeleteId(voice.id)} className="text-slate-400 disabled:opacity-50">删除</button>}
          </div>
        </div>
      ))}
      {open ? (
        <fieldset disabled={disabled} className="min-w-0 space-y-3 disabled:opacity-60">
          <p className="text-xs leading-5 text-slate-600">上传自己或已获授权的清晰录音，推荐 10～20 秒，避免背景音乐和多人说话。</p>
          <label className="block text-xs font-medium text-slate-600">声音名称
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="给熟悉的声音起个名字" className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-cyan-300" />
          </label>
          <label className="block text-xs font-medium text-slate-600">参考录音
            <input ref={fileRef} type="file" accept=".wav,.mp3,.m4a,.webm,.ogg,.mp4" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(""); }} className="mt-1 block w-full min-w-0 text-xs text-slate-500 file:mr-2 file:rounded-md file:border-0 file:bg-white file:px-2 file:py-2 file:text-cyan-700" />
          </label>
          <p className="text-[11px] leading-5 text-slate-500">创建音色免费，试听和说话消耗百炼语音额度；免费额度及有效期以账户为准。录音仅用于本次复刻，本地保存音色信息。</p>
          <button type="button" onClick={() => void createVoice()} disabled={!file || !name.trim()} className="w-full rounded-md bg-cyan-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">创建并选用</button>
        </fieldset>
      ) : null}
      {busy ? <p role="status" className="text-xs text-cyan-700">正在处理，请稍候…</p> : null}
      {error ? <p role="alert" className="break-words text-xs leading-5 text-rose-600">{error}</p> : null}
      {message ? <p role="status" className="text-xs leading-5 text-cyan-700">{message}</p> : null}
      {locked ? <p className="text-xs text-slate-500">结束当前对话后可创建或切换专属声音。</p> : null}
    </div>
  );
}
