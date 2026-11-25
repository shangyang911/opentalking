import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarSelectionStage } from "../features/avatars/components/AvatarSelectionStage";
import { ChatInput } from "../features/conversation/components/ChatInput";
import { ChatMessages } from "../features/conversation/components/ChatMessages";
import { SETTINGS_DOCK_EXPANDED_KEY, SettingsPanel } from "../features/settings/SettingsPanel";
import { RuntimeConfigWorkspace } from "../features/settings/RuntimeConfigWorkspace";
import { SceneStage } from "../features/avatars/components/SceneStage";
import { TopBar, type ConversationViewMode, type StudioWorkflow } from "./TopBar";
import { ToastStack, type ToastMessage, type ToastTone } from "../shared/ui/ToastStack";
import { AssetLibraryWorkspace } from "../features/works/AssetLibraryWorkspace";
import { playWithMutedFallback } from "../shared/ui/VideoBackground";
import { VideoCreationWorkspace } from "../features/video-creation/VideoCreationWorkspace";
import { voiceModelsForProvider, voiceOptionsForProvider, type ClonedVoice } from "../features/voices/voiceClone";
import { ApiError, apiDelete, apiGet, apiPost, apiPostForm, buildApiUrl } from "../shared/api/client";
import { applyRuntimeConfig, loadRuntimeConfig, type RuntimeConfigApplyInput, type RuntimeConfigResponse } from "../features/settings/api";
import { uploadExportVideo } from "../features/works/api";
import { type AvatarSummary } from "../features/avatars/api";
import { type CreateSessionRequest, type CreateSessionResponse } from "../features/conversation/api";
import { modelConnectionBadge, type ModelStatus } from "../features/avatars/modelStatus";
import { modelLabel } from "../features/avatars/modelLabels";
import { connectSse } from "../features/conversation/sse";
import { DEFAULT_TTS_PREVIEW_TEXT, buildTTSPreviewPayload, requestTTSPreview } from "../features/voices/ttsPreview";
import { startPlayback } from "../features/conversation/webrtc";
import { captureRecordingVideo } from "../features/conversation/recording";
import { DEFAULT_EDGE_VOICE_ID, EDGE_VOICE_STORAGE_KEY, EDGE_ZH_VOICES } from "../features/voices/constants/edgeZhVoices";
import { type TtsProviderExtended, isEdgeTts } from "../features/voices/constants/ttsBailian";
import {
  DEFAULT_QWEN_MODEL_ID, DEFAULT_QWEN_VOICE_ID, QWEN_MODEL_STORAGE_KEY,
  QWEN_VOICE_STORAGE_KEY,
  TTS_PROVIDER_STORAGE_KEY,
} from "../features/voices/constants/ttsQwen";
import type { ConnectionStatus, Message, QueueInfo } from "../shared/types";
import { type Account } from "../features/auth/api";
import { accountDisplayName, loadProfile, profileAvatarSrc, type Profile } from '../features/account/api';
import { PersonalCenter } from '../features/account/PersonalCenter';
import { KnowledgeWorkspace } from '../features/knowledge/KnowledgeWorkspace';
import { knowledgeSessionFields, knowledgeSettingsKey, parseKnowledgeSettings, type KnowledgeSettings } from '../features/knowledge/config';
import { SessionKnowledgeStatus } from '../features/knowledge/SessionKnowledgeStatus';
import { MembershipDialog } from '../features/billing/MembershipDialog';
import { useMembership } from '../features/billing/useMembership';
import { minutes } from '../features/billing/api';
import { canChangeModelForAvatar, normalizeAvatarModelSelection, pickInitialAvatarForModel,
  recommendAvatarForModel } from "../features/avatars/avatarSelection";

function normalizeTtsProvider(value: string | null | undefined, fallback: TtsProviderExtended = "edge"): TtsProviderExtended {
  return value === "edge" || value === "dashscope" || value === "cosyvoice" ? value : fallback;
}

type VoiceOpt = { id: string; label: string; targetModel?: string | null };
type PanelTab = "chat" | "status" | "exports";

const PANEL_TABS: { id: PanelTab; label: string }[] = [
  { id: "chat", label: "对话" },
  { id: "status", label: "状态" },
  { id: "exports", label: "导出" },
];

const MESSAGE_STORAGE_KEY = "opentalking-chat-history";
const LLM_SYSTEM_PROMPT_STORAGE_KEY = "opentalking-llm-system-prompt";
const SESSION_PANEL_COLLAPSED_KEY = "opentalking-session-panel-collapsed";
const CUSTOM_REFERENCE_NAME_KEY = "opentalking-custom-reference-name";
const SELECTED_AVATAR_STORAGE_KEY = "opentalking-selected-avatar-id";
const SELECTED_AVATAR_SOURCE_STORAGE_KEY = "opentalking-selected-avatar-source-v1";
const CLIENT_USER_ID_KEY = "opentalking-client-user-id";
const ASR_PROVIDER_STORAGE_KEY = "opentalking-asr-provider-v1";
const CONVERSATION_VIEW_MODE_KEY = "opentalking-conversation-view-mode-v1";
const STT_MODEL_BY_PROVIDER: Record<string, string> = { dashscope: "qwen-audio-3.1-asr-flash-streaming" };

function normalizeAsrProvider(value: string | null | undefined, fallback = "dashscope"): string {
  const provider = (value ?? "").trim();
  return ["dashscope"].includes(provider) ? provider : fallback;
}

function sttModelForProvider(provider: string): string {
  return STT_MODEL_BY_PROVIDER[normalizeAsrProvider(provider)] ?? "OPENTALKING_STT_MODEL";
}

function sttProviderNeedsApiKey(provider: string): boolean {
  return normalizeAsrProvider(provider, "dashscope") === "dashscope";
}

function ttsProviderNeedsApiKey(provider: TtsProviderExtended): boolean {
  return provider !== "edge";
}

function hasSelectableTtsVoice(provider: TtsProviderExtended): boolean {
  return provider !== "edge";
}

function ttsModelSelectable(provider: TtsProviderExtended): boolean {
  return provider !== "edge";
}

function resolveSelectableTtsVoice(
  provider: TtsProviderExtended,
  voice: string,
  options: VoiceOpt[],
): string {
  if (!hasSelectableTtsVoice(provider)) return "";
  const trimmed = voice.trim();
  if (trimmed && options.some((option) => option.id === trimmed)) return trimmed;
  return options[0]?.id ?? "";
}

type StoredAvatarSelection = { id: string; source: string | null };

function readStoredAvatarSelection(): StoredAvatarSelection | null {
  try {
    const id = window.localStorage.getItem(SELECTED_AVATAR_STORAGE_KEY);
    if (!id) return null;
    return {
      id,
      source: window.localStorage.getItem(SELECTED_AVATAR_SOURCE_STORAGE_KEY),
    };
  } catch {
    return null;
  }
}

function readStoredAvatarId(): string | null {
  return readStoredAvatarSelection()?.id ?? null;
}

function writeStoredAvatarId(avatarId: string, source: "auto" | "explicit" = "explicit"): void {
  try {
    if (avatarId) {
      window.localStorage.setItem(SELECTED_AVATAR_STORAGE_KEY, avatarId);
      window.localStorage.setItem(SELECTED_AVATAR_SOURCE_STORAGE_KEY, source);
    } else {
      window.localStorage.removeItem(SELECTED_AVATAR_STORAGE_KEY);
      window.localStorage.removeItem(SELECTED_AVATAR_SOURCE_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

function readOrCreateClientUserId(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_USER_ID_KEY)?.trim();
    if (existing) return existing;
    const randomPart =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const next = `client_${randomPart}`;
    window.localStorage.setItem(CLIENT_USER_ID_KEY, next);
    return next;
  } catch {
    return `client_${Date.now().toString(36)}`;
  }
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.detail) return error.detail;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function validateAudioProviderConfigBeforeStart({
  sttProvider,
  ttsProvider,
  runtimeStatus,
}: {
  sttProvider: string;
  ttsProvider: TtsProviderExtended;
  runtimeStatus: HealthResponse | null;
}): string | null {
  const missing: string[] = [];
  const sttStatus = runtimeStatus?.stt_providers?.[normalizeAsrProvider(sttProvider, "dashscope")];
  const ttsStatus = runtimeStatus?.tts_providers?.[ttsProvider];
  const sttKeySet = sttStatus?.key_set ?? runtimeStatus?.stt_key_set;
  const ttsKeySet = ttsStatus?.key_set ?? runtimeStatus?.tts_key_set;
  if (sttProviderNeedsApiKey(sttProvider) && sttKeySet !== true) {
    missing.push("百炼语音识别尚未配置 API Key");
  }
  if (ttsProviderNeedsApiKey(ttsProvider) && ttsKeySet !== true) {
    missing.push("百炼语音合成尚未配置 API Key");
  }
  if (missing.length === 0) return null;
  return `${missing.join("；")}。请在后端 .env 配置后重启服务。`;
}

type SpeakAudioResponse = { session_id: string; status: string; text: string };
type SessionRecord = { session_id: string; state?: string };
type PrewarmState = "idle" | "preparing" | "ready" | "failed";
type AvatarPrewarmResponse = {
  avatar_id: string;
  model: string;
  status: "ready" | "failed" | string;
  runtime_status?: "ready" | "failed" | "skipped" | string;
  cache?: { status?: string; frames?: number | null; detail?: string | null };
  runtime?: { type?: string; cache_hit?: boolean; elapsed_ms?: number; message?: string | null };
};
type HealthResponse = {
  status: string;
  tts_provider?: string;
  tts_key_set?: boolean;
  tts_service_url_set?: boolean;
  tts_default_provider?: string;
  tts_enabled_providers?: string[];
  tts_providers?: Record<string, { key_set?: boolean; model?: string; model_dir?: string; service_url_set?: boolean }>;
  stt_provider?: string;
  stt_key_set?: boolean;
  stt_model?: string;
  stt_device?: string;
  stt_default_provider?: string;
  stt_enabled_providers?: string[];
  stt_providers?: Record<string, { key_set?: boolean; model?: string; model_dir?: string; device?: string; service_url_set?: boolean }>;
};

function readChatMaxVisible(): number {
  const raw = import.meta.env.VITE_CHAT_MAX_VISIBLE;
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(500, Math.floor(n));
}

let msgCounter = 0;
let toastCounter = 0;
function makeId() {
  return `msg-${++msgCounter}-${Date.now()}`;
}

function makeToastId() {
  return `toast-${++toastCounter}-${Date.now()}`;
}

function pickInitialAvatar(
  avatars: AvatarSummary[],
  registeredModels: string[],
  storedSelection?: StoredAvatarSelection | null,
  defaultModel?: string | null,
): AvatarSummary | null {
  if (!avatars.length) return null;
  const available = new Set(registeredModels);
  if (defaultModel) {
    const recommended = pickInitialAvatarForModel(avatars, defaultModel, storedSelection ?? null);
    if (recommended?.client_renderer?.recommended_for.includes(defaultModel)) return recommended;
  }
  const customAvatar = pickInitialCustomAvatar(avatars, available);
  const storedAvatar = storedSelection?.id
    ? avatars.find((avatar) => avatar.id === storedSelection.id)
    : null;
  if (
    storedAvatar &&
    (storedSelection?.source === "explicit" || storedAvatar.is_custom || !customAvatar)
  ) {
    return storedAvatar;
  }
  if (customAvatar) return customAvatar;
  return (
    avatars.find((a) => a.id === "quicktalk-daytime" && available.has("quicktalk")) ??
    avatars.find((a) => a.model_type === "quicktalk" && available.has("quicktalk")) ??
    avatars.find((a) => a.model_type === "flashhead" && available.has("flashhead")) ??
    avatars.find((a) => a.model_type === "flashtalk" && available.has("flashtalk")) ??
    avatars.find((a) => a.model_type === "musetalk" && available.has("musetalk")) ??
    avatars.find((a) => available.has(a.model_type)) ??
    avatars[0]
  );
}

function pickInitialCustomAvatar(
  avatars: AvatarSummary[],
  available: Set<string>,
): AvatarSummary | null {
  return (
    avatars.find((avatar) => avatar.is_custom && available.has(avatar.model_type)) ??
    avatars.find((avatar) => avatar.is_custom) ??
    null
  );
}

function pickInitialModel(
  currentModel: string,
  registeredModels: string[],
  statuses: ModelStatus[],
  initialAvatar: AvatarSummary | null,
  defaultModel?: string | null,
): string {
  const available = new Set(registeredModels);
  const connected = new Set(
    statuses.filter((status) => modelConnectionBadge(status).connected).map((status) => status.id),
  );
  if (defaultModel && available.has(defaultModel) && connected.has(defaultModel)) return defaultModel;
  if (available.has(currentModel) && connected.has(currentModel)) return currentModel;
  const avatarModel = initialAvatar?.model_type;
  if (avatarModel && available.has(avatarModel) && connected.has(avatarModel)) return avatarModel;
  for (const preferred of ["quicktalk", "mock"]) {
    if (available.has(preferred) && connected.has(preferred)) return preferred;
  }
  const firstConnected = registeredModels.find((id) => connected.has(id));
  return firstConnected ?? registeredModels[0] ?? avatarModel ?? currentModel;
}

const SERVER_AUDIO_RENDERERS = new Set(["quicktalk"]);

function isFlashRenderer(model: string): boolean {
  return SERVER_AUDIO_RENDERERS.has(model);
}

function usesCompactSquareStage(model: string): boolean {
  return model === "flashhead";
}

const PREWARMABLE_MODELS = new Set(["quicktalk"]);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PendingRealtimeExport = {
  accountId?: number;
  blob: Blob;
  title: string;
  durationSec: number;
  sessionId: string | null;
  avatarId: string;
  model: string;
};

function selectMediaRecorderMimeType(candidates: string[]): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function realtimeExportTitle(model: string): string {
  return `实时对话录制 · ${modelLabel(model)}`;
}

async function requestUserAudioWithTimeout(microphonePermissionTimeoutMs = 8000): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException("media devices unavailable", "NotSupportedError");
  }
  let settled = false;
  let timeoutId: number | null = null;
  const request = navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    settled = true;
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    return stream;
  });
  const timeout = new Promise<MediaStream>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      if (settled) return;
      reject(new DOMException("microphone permission timeout", "TimeoutError"));
    }, microphonePermissionTimeoutMs);
  });
  return Promise.race([request, timeout]);
}

function realtimeRecordingLocalhostHelpUrl(): string {
  const port = window.location.port ? `:${window.location.port}` : "";
  return `http://127.0.0.1${port}/`;
}

function realtimeRecordingStartErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  const mediaDevicesUnavailable = !navigator.mediaDevices?.getUserMedia;
  const insecureOrigin = typeof window !== "undefined" && !window.isSecureContext;

  if (insecureOrigin && (name === "NotSupportedError" || name === "SecurityError" || mediaDevicesUnavailable)) {
    return `当前访问地址不是浏览器安全来源，无法请求麦克风。请通过本机 ${realtimeRecordingLocalhostHelpUrl()} 隧道或 HTTPS 打开后重试。`;
  }
  if (name === "TimeoutError") {
    return "麦克风权限请求超时，请在浏览器地址栏允许麦克风后重试。";
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "麦克风权限被拒绝，无法录制用户声音。请在浏览器地址栏允许麦克风后重试。";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "未检测到可用麦克风。请连接麦克风，或确认系统输入设备可用后重试。";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "麦克风正在被其他应用占用，关闭占用程序后重试。";
  }
  if (name === "NotSupportedError" || mediaDevicesUnavailable) {
    return "当前浏览器不支持麦克风录制。请换用新版 Chrome，并确认通过 localhost 或 HTTPS 访问。";
  }
  if (name === "InvalidStateError") {
    return "当前会话画面还没有准备好，请等数字人视频出现后再开始录制。";
  }
  return name || message
    ? `开始录制失败（${name || message}），请确认浏览器权限和当前会话状态。`
    : "开始录制失败：请确认浏览器权限和当前会话状态。";
}

export default function App({ account = null, onLogout, billingEnabled = false }: { account?: Account | null; onLogout?: () => Promise<void>; billingEnabled?: boolean } = {}) {
  const membership = useMembership(account?.role === 'user' && billingEnabled, false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState('');
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [personalOpen, setPersonalOpen] = useState(() => window.location.pathname === '/account');
  const workbenchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (account?.role !== 'user') return;
    let active = true;
    void loadProfile().then(next => { if (active) { setProfile(next); setProfileError(''); } })
      .catch(reason => { if (active) setProfileError(reason instanceof Error ? reason.message : '个人资料读取失败'); });
    return () => { active = false; };
  }, [account?.id, profileAttempt]);
  useEffect(() => {
    const pop = () => setPersonalOpen(window.location.pathname === '/account');
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    if (personalOpen && membership.open) membership.setOpen(false);
  }, [personalOpen, membership.open, membership.setOpen]);
  useEffect(() => {
    if (personalOpen && account?.role === 'user') workbenchRef.current?.setAttribute('inert', '');
    else workbenchRef.current?.removeAttribute('inert');
    if (!personalOpen || account?.role !== 'user') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [personalOpen, account?.role]);
  const navigatePersonal = (open: boolean) => {
    const url = new URL(window.location.href); url.pathname = open ? '/account' : '/';
    window.history.pushState(null, '', url); setPersonalOpen(open);
  };
  const messageStorageKey = account ? `${MESSAGE_STORAGE_KEY}:${account.id}` : MESSAGE_STORAGE_KEY;
  const videoRef = useRef<HTMLVideoElement>(null);
  const recordingCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const realtimeRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingCompletionRef = useRef<Promise<void> | null>(null);
  const recordingGenerationRef = useRef(0);
  const workspaceActiveRef = useRef(true);
  const logoutBusyRef = useRef(false);
  const realtimeRecordChunksRef = useRef<Blob[]>([]);
  const realtimeRecordStartedAtRef = useRef(0);
  const realtimeRecordStreamRef = useRef<MediaStream | null>(null);
  const realtimeRecordCaptureStreamRef = useRef<MediaStream | null>(null);
  const realtimeRecordMicStreamRef = useRef<MediaStream | null>(null);
  const pendingRealtimeExportRef = useRef<PendingRealtimeExport | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const speakAudioAbortRef = useRef<AbortController | null>(null);
  const ttsPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsPreviewUrlRef = useRef<string | null>(null);
  /** Cumulative assistant text for the current speech turn (subtitle.chunk segments). */
  const subtitleAccRef = useRef("");
  /** `messages` id of the in-progress assistant bubble for this turn; cleared on speech.ended. */
  const streamingAssistantMsgIdRef = useRef<string | null>(null);
  /** Local placeholder shown immediately after the user sends text, before worker SSE arrives. */
  const pendingAssistantMsgIdRef = useRef<string | null>(null);
  /** 首帧已进入 WebRTC 后再叠字幕（与口型对齐）；旧版 Worker 无 speech.media_started 时用定时回退 */
  const subtitleMediaReadyRef = useRef(false);
  const subtitleFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Data
  const [avatars, setAvatars] = useState<AvatarSummary[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [modelStatuses, setModelStatuses] = useState<ModelStatus[]>([]);
  const [avatarId, setAvatarId] = useState(() => readStoredAvatarId() ?? "singer");
  const [model, setModel] = useState("quicktalk");
  const [prewarmByKey, setPrewarmByKey] = useState<Record<string, PrewarmState>>({});
  const prewarmInFlightRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const prewarmSeqRef = useRef(0);
  const [workflow, setWorkflow] = useState<StudioWorkflow>("realtime");

  // Connection
  const [connection, setConnection] = useState<ConnectionStatus>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionEnding, setSessionEnding] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [queueInfo, setQueueInfo] = useState<QueueInfo | null>(null);
  const [expiringCountdown, setExpiringCountdown] = useState<number | null>(null);

  // Chat
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentSubtitle, setCurrentSubtitle] = useState("");
  const [, setRuntimeStatus] = useState<HealthResponse | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigResponse | null>(null);
  const [runtimeConfigLoading, setRuntimeConfigLoading] = useState(false);
  const [runtimeConfigApplying, setRuntimeConfigApplying] = useState(false);

  const clearSubtitleFallbackTimer = useCallback(() => {
    if (subtitleFallbackTimerRef.current !== null) {
      clearTimeout(subtitleFallbackTimerRef.current);
      subtitleFallbackTimerRef.current = null;
    }
  }, []);

  const flushSubtitleDisplay = useCallback(() => {
    const t = subtitleAccRef.current;
    if (t) setCurrentSubtitle(t);
  }, []);

  const flushSubtitleMessage = useCallback(() => {
    const msgId = streamingAssistantMsgIdRef.current;
    const t = subtitleAccRef.current;
    if (!msgId || !t) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, text: t } : m)),
    );
  }, []);

  const clearSubtitleState = useCallback(() => {
    setCurrentSubtitle("");
    subtitleAccRef.current = "";
    subtitleMediaReadyRef.current = false;
    clearSubtitleFallbackTimer();
    streamingAssistantMsgIdRef.current = null;
    pendingAssistantMsgIdRef.current = null;
    setIsSpeaking(false);
  }, [clearSubtitleFallbackTimer]);

  const appendAssistantError = useCallback((message: string) => {
    const normalized = message.startsWith("出错了：") ? message : `出错了：${message}`;
    const msgId = streamingAssistantMsgIdRef.current ?? pendingAssistantMsgIdRef.current;
    clearSubtitleState();
    if (msgId) {
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, text: normalized } : m)),
      );
      return;
    }
    setMessages((prev) => [
      ...prev,
      { id: makeId(), role: "assistant", text: normalized, timestamp: Date.now() },
    ]);
  }, [clearSubtitleState]);

  // UI
  const [settingsExpanded, setSettingsExpanded] = useState(() => {
    try {
      const s = window.localStorage.getItem(SETTINGS_DOCK_EXPANDED_KEY);
      if (s === "1") return true;
      if (s === "0") return false;
    } catch {
      /* ignore */
    }
    return false;
  });
  const [referenceSaving, setReferenceSaving] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("chat");
  const [sessionPanelCollapsed, setSessionPanelCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SESSION_PANEL_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof window.setTimeout>>>(new Map());
  const [recordingSaving, setRecordingSaving] = useState(false);
  const [ftRecordPhase, setFtRecordPhase] = useState<"idle" | "recording" | "stopped">("idle");
  const [ftRecordBusy, setFtRecordBusy] = useState(false);
  const [assetLibraryRefreshKey, setAssetLibraryRefreshKey] = useState(0);
  const [videoGenerating, setVideoGenerating] = useState(false);
  const [conversationViewMode, setConversationViewMode] = useState<ConversationViewMode>(() => {
    try {
      return window.localStorage.getItem(CONVERSATION_VIEW_MODE_KEY) === "immersive" ? "immersive" : "studio";
    } catch {
      return "studio";
    }
  });
  const [immersiveAvatarAdjust, setImmersiveAvatarAdjust] = useState({ x: 0, y: 0, scale: 1 });
  const [ttsPreviewText, setTtsPreviewText] = useState(DEFAULT_TTS_PREVIEW_TEXT);
  const [ttsPreviewing, setTtsPreviewing] = useState(false);
  const [clientUserId] = useState(readOrCreateClientUserId);
  const [savedKnowledge] = useState(() => {
    try { return parseKnowledgeSettings(window.localStorage.getItem(knowledgeSettingsKey(account?.id))); }
    catch { return { ids: [], memoryEnabled: false }; }
  });
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState<string[]>(savedKnowledge.ids);
  const [explicitMemoryEnabled, setExplicitMemoryEnabled] = useState(savedKnowledge.memoryEnabled);
  const [sessionKnowledge, setSessionKnowledge] = useState<KnowledgeSettings | null>(null);
  const [reconnectKnowledgeRequested, setReconnectKnowledgeRequested] = useState(false);
  useEffect(() => {
    try { window.localStorage.setItem(knowledgeSettingsKey(account?.id), JSON.stringify({ ids: knowledgeBaseIds, memoryEnabled: explicitMemoryEnabled })); }
    catch { /* Settings remain available in this tab when browser storage is disabled. */ }
  }, [account?.id, knowledgeBaseIds, explicitMemoryEnabled]);
  const selectedModelStatus = modelStatuses.find((item) => item.id === model);
  const selectedModelBadge = modelConnectionBadge(selectedModelStatus, models.includes(model));
  const selectedModelConnected = selectedModelBadge.connected;
  const [asrProvider, setAsrProvider] = useState(() => {
    try {
      const saved = window.localStorage.getItem(ASR_PROVIDER_STORAGE_KEY);
      return saved ? normalizeAsrProvider(saved, "dashscope") : "";
    } catch {
      return "";
    }
  });
  const [asrModel, setAsrModel] = useState(STT_MODEL_BY_PROVIDER.dashscope);
  const [activeAsrProvider, setActiveAsrProvider] = useState("");
  const [edgeVoice, setEdgeVoice] = useState<string>(() => {
    try {
      const s = window.localStorage.getItem(EDGE_VOICE_STORAGE_KEY);
      if (s && EDGE_ZH_VOICES.some((v) => v.id === s)) return s;
    } catch {
      /* ignore */
    }
    return DEFAULT_EDGE_VOICE_ID;
  });

  const [ttsProvider, setTtsProvider] = useState<TtsProviderExtended>(() => {
    try {
      const s = window.localStorage.getItem(TTS_PROVIDER_STORAGE_KEY)?.trim();
      const normalized = normalizeTtsProvider(s, "edge");
      if (normalized !== "edge" || s === "edge") return normalized;
    } catch {
      /* ignore */
    }
    return "edge";
  });

  const [qwenModel, setQwenModel] = useState<string>(() => {
    try {
      const s = window.localStorage.getItem(QWEN_MODEL_STORAGE_KEY)?.trim();
      if (s && /^[\w.-]+$/.test(s)) return s;
    } catch {
      /* ignore */
    }
    return DEFAULT_QWEN_MODEL_ID;
  });

  const [qwenVoice, setQwenVoice] = useState<string>(() => {
    try {
      const s = window.localStorage.getItem(QWEN_VOICE_STORAGE_KEY)?.trim();
      if (s && s.length > 0 && s.length <= 256) return s;
    } catch {
      /* ignore */
    }
    return DEFAULT_QWEN_VOICE_ID;
  });
  const [clonedVoices, setClonedVoices] = useState<ClonedVoice[]>([]);
  const [clonedVoicesLoaded, setClonedVoicesLoaded] = useState(false);
  const [clonedVoicesLoading, setClonedVoicesLoading] = useState(false);
  const [clonedVoicesError, setClonedVoicesError] = useState("");
  const [voiceCloningBusy, setVoiceCloningBusy] = useState(false);
  const voiceCloningBusyRef = useRef(false);
  const handleVoiceBusyChange = useCallback((busy: boolean) => {
    voiceCloningBusyRef.current = busy;
    setVoiceCloningBusy(busy);
  }, []);
  const refreshClonedVoices = useCallback(async () => {
    setClonedVoicesLoading(true);
    setClonedVoicesError("");
    try {
      const data = await apiGet<{ voices: ClonedVoice[] }>("/voices");
      setClonedVoices(data.voices);
      setClonedVoicesLoaded(true);
    } catch {
      setClonedVoicesError("专属声音读取失败。");
    } finally {
      setClonedVoicesLoading(false);
    }
  }, []);
  useEffect(() => { void refreshClonedVoices(); }, [refreshClonedVoices]);

  const useClonedVoice = useCallback((voice: ClonedVoice) => {
    setTtsProvider("cosyvoice");
    setQwenModel(voice.target_model);
    setQwenVoice(voice.voice_id);
  }, []);
  const handleVoiceCreated = useCallback((voice: ClonedVoice) => {
    setClonedVoices((previous) => [...previous.filter((item) => item.id !== voice.id), voice]);
    setClonedVoicesLoaded(true);
    useClonedVoice(voice);
  }, [useClonedVoice]);
  const handleVoiceDeleted = useCallback((id: number) => {
    setClonedVoices((previous) => previous.filter((voice) => voice.id !== id));
  }, []);

  const compactSquareStage = usesCompactSquareStage(model);
  const dismissToast = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    toastTimersRef.current.delete(id);
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    const id = makeToastId();
    setToasts((prev) => [...prev.slice(-2), { id, tone, message }]);
    if (tone !== "error") {
      const timer = window.setTimeout(() => {
        toastTimersRef.current.delete(id);
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
      }, 3600);
      toastTimersRef.current.set(id, timer);
    }
  }, []);

  const pauseToast = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (!timer) return;
    window.clearTimeout(timer);
    toastTimersRef.current.delete(id);
  }, []);

  const resumeToast = useCallback((id: string) => {
    const toast = toasts.find((item) => item.id === id);
    if (!toast || toast.tone === "error" || toastTimersRef.current.has(id)) return;
    const timer = window.setTimeout(() => {
      toastTimersRef.current.delete(id);
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 1800);
    toastTimersRef.current.set(id, timer);
  }, [toasts]);

  const syncRuntimeConfigSelection = useCallback((next: RuntimeConfigResponse, preserveClonedVoice = false) => {
    const nextAsrProvider = normalizeAsrProvider(next.stt.provider, "dashscope");
    setAsrProvider(nextAsrProvider);
    setAsrModel(next.stt.model || sttModelForProvider(nextAsrProvider));

    if (preserveClonedVoice) {
      try {
        if (window.localStorage.getItem(TTS_PROVIDER_STORAGE_KEY) === "cosyvoice") return;
      } catch { /* use server defaults when browser storage is unavailable */ }
    }

    const nextTtsProvider = normalizeTtsProvider(next.tts.provider, "edge");
    setTtsProvider(nextTtsProvider);
    if (next.tts.model) {
      setQwenModel(next.tts.model);
    }
    if (next.tts.voice) {
      if (nextTtsProvider === "edge") {
        setEdgeVoice(next.tts.voice);
      } else {
        setQwenVoice(next.tts.voice);
      }
    }
  }, []);

  const refreshRuntimeConfig = useCallback(async () => {
    setRuntimeConfigLoading(true);
    try {
      const next = await loadRuntimeConfig();
      setRuntimeConfig(next);
      syncRuntimeConfigSelection(next);
      return next;
    } catch (error) {
      console.warn("load runtime config failed", error);
      const detail = error instanceof ApiError ? error.detail : null;
      notify(detail ? `运行配置读取失败：${detail}` : "运行配置读取失败，请查看后端日志。", "error");
      return null;
    } finally {
      setRuntimeConfigLoading(false);
    }
  }, [notify, syncRuntimeConfigSelection]);

  const handleApplyRuntimeConfig = useCallback(async (input: RuntimeConfigApplyInput) => {
    setRuntimeConfigApplying(true);
    try {
      const next = await applyRuntimeConfig(input);
      setRuntimeConfig(next);
      syncRuntimeConfigSelection(next);
      void apiGet<HealthResponse>("/health")
        .then(setRuntimeStatus)
        .catch((error) => console.warn("refresh health after runtime config failed", error));
      notify(next.requires_new_session ? "运行配置已保存，下次会话生效。" : "运行配置已应用。", "success");
    } catch (error) {
      console.warn("apply runtime config failed", error);
      const detail = error instanceof ApiError ? error.detail : null;
      notify(detail ? `运行配置应用失败：${detail}` : "运行配置应用失败，请查看后端日志。", "error");
      throw error;
    } finally {
      setRuntimeConfigApplying(false);
    }
  }, [notify, syncRuntimeConfigSelection]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CONVERSATION_VIEW_MODE_KEY, conversationViewMode);
    } catch {
      /* ignore */
    }
  }, [conversationViewMode]);

  useEffect(() => {
    const startupVisible = connection === "idle" || connection === "error" || connection === "connecting" || connection === "queued";
    if (startupVisible && conversationViewMode === "immersive") setConversationViewMode("studio");
  }, [connection, conversationViewMode]);

  useEffect(() => {
    if (workflow !== "realtime" || conversationViewMode !== "immersive") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setConversationViewMode("studio");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [conversationViewMode, workflow]);

  const cleanupRealtimeRecordStreams = useCallback(() => {
    if (realtimeRecordMicStreamRef.current) {
      for (const track of realtimeRecordMicStreamRef.current.getTracks()) track.stop();
      realtimeRecordMicStreamRef.current = null;
    }
    if (realtimeRecordStreamRef.current) {
      for (const track of realtimeRecordStreamRef.current.getTracks()) track.stop();
      realtimeRecordStreamRef.current = null;
    }
    if (realtimeRecordCaptureStreamRef.current) {
      for (const track of realtimeRecordCaptureStreamRef.current.getTracks()) track.stop();
      realtimeRecordCaptureStreamRef.current = null;
    }
  }, []);

  const uploadRealtimeExport = useCallback(async (pending: PendingRealtimeExport) => {
    // An old workspace must not upload private recordings after an account switch.
    if (!workspaceActiveRef.current) return;
    setRecordingSaving(true);
    try {
      const saved = await uploadExportVideo({
        accountId: pending.accountId,
        blob: pending.blob,
        kind: "realtime_dialogue",
        title: pending.title,
        durationSec: pending.durationSec,
        sessionId: pending.sessionId,
        avatarId: pending.avatarId,
        model: pending.model,
      });
      pendingRealtimeExportRef.current = null;
      setAssetLibraryRefreshKey((value) => value + 1);
      setFtRecordPhase("idle");
      notify(`录制已保存，可在作品库查看：${saved.title}`, "success");
    } catch (error) {
      console.warn("upload realtime export failed", error);
      pendingRealtimeExportRef.current = pending;
      setFtRecordPhase("stopped");
      const detail = error instanceof ApiError ? error.detail : null;
      notify(detail ? `录制上传失败：${detail}` : "录制上传失败，可点击重试保存。", "error");
    } finally {
      setRecordingSaving(false);
    }
  }, [notify]);

  const retryPendingRealtimeExport = useCallback(async () => {
    const pending = pendingRealtimeExportRef.current;
    if (!pending) {
      notify("没有待重试保存的录制。", "info");
      setFtRecordPhase("idle");
      return;
    }
    await uploadRealtimeExport(pending);
  }, [notify, uploadRealtimeExport]);

  const stopRealtimeRecording = useCallback(() => {
    const recorder = realtimeRecorderRef.current;
    if (!recorder) return;
    if (recorder.state !== "inactive") recorder.stop();
  }, []);

  const startRealtimeRecording = useCallback(async () => {
    if (logoutBusyRef.current) return;
    const generation = recordingGenerationRef.current;
    if (!sessionId || connection !== "live" && connection !== "expiring") {
      notify("请先连接实时对话会话，再开始录制。", "info");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      notify("当前浏览器不支持 MediaRecorder，无法录制。", "error");
      return;
    }
    if (realtimeRecorderRef.current?.state === "recording") return;

    setFtRecordBusy(true);
    let audioContext: AudioContext | null = null;
    try {
      cleanupRealtimeRecordStreams();
      const stageStream = captureRecordingVideo(videoRef.current, recordingCanvasRef.current);
      realtimeRecordCaptureStreamRef.current = stageStream;
      const recordVideoTracks = stageStream.getVideoTracks().map((track) => track.clone());
      // Keep the capture source alive until the cloned recording tracks stop.
      for (const track of stageStream.getAudioTracks()) track.stop();
      const outputStream = new MediaStream(recordVideoTracks);
      realtimeRecordStreamRef.current = outputStream;
      audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      let hasAudio = false;

      const micStream = await requestUserAudioWithTimeout();
      if (generation !== recordingGenerationRef.current || logoutBusyRef.current) {
        for (const track of micStream.getTracks()) track.stop();
        void audioContext.close().catch(() => {});
        return;
      }
      realtimeRecordMicStreamRef.current = micStream;
      if (micStream.getAudioTracks().length > 0) {
        audioContext.createMediaStreamSource(micStream).connect(destination);
        hasAudio = true;
      }

      const remoteAudioTracks = remoteStreamRef.current?.getAudioTracks() ?? [];
      if (remoteAudioTracks.length > 0) {
        const remoteAudioStream = new MediaStream(remoteAudioTracks);
        audioContext.createMediaStreamSource(remoteAudioStream).connect(destination);
        hasAudio = true;
      }
      if (hasAudio) {
        for (const track of destination.stream.getAudioTracks()) outputStream.addTrack(track);
      }
      const mimeType = selectMediaRecorderMimeType([
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        "video/mp4",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ]);
      const recorder = new MediaRecorder(outputStream, mimeType ? { mimeType } : undefined);
      realtimeRecordChunksRef.current = [];
      realtimeRecordStartedAtRef.current = performance.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) realtimeRecordChunksRef.current.push(event.data);
      };
      let finishRecording = () => {};
      recorder.onstop = () => {
        const chunks = realtimeRecordChunksRef.current;
        realtimeRecordChunksRef.current = [];
        realtimeRecorderRef.current = null;
        void audioContext?.close().catch(() => {});
        cleanupRealtimeRecordStreams();
        const durationSec = Math.max(0.1, (performance.now() - realtimeRecordStartedAtRef.current) / 1000);
        if (!chunks.length) {
          setFtRecordPhase("idle");
          notify("录制内容为空，未生成导出视频。", "error");
          finishRecording();
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
        const pending: PendingRealtimeExport = {
          accountId: account?.id,
          blob,
          title: realtimeExportTitle(model),
          durationSec,
          sessionId,
          avatarId,
          model,
        };
        void uploadRealtimeExport(pending).finally(finishRecording);
      };
      recorder.start(1000);
      recordingCompletionRef.current = new Promise<void>((resolve) => { finishRecording = resolve; });
      realtimeRecorderRef.current = recorder;
      pendingRealtimeExportRef.current = null;
      setFtRecordPhase("recording");
      notify("已开始录制实时对话。", "success");
    } catch (error) {
      console.warn("start realtime recording failed", error);
      void audioContext?.close().catch(() => {});
      cleanupRealtimeRecordStreams();
      notify(realtimeRecordingStartErrorMessage(error), "error");
    } finally {
      setFtRecordBusy(false);
    }
  }, [account?.id, avatarId, cleanupRealtimeRecordStreams, connection, model, notify, sessionId, uploadRealtimeExport]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SESSION_PANEL_COLLAPSED_KEY, sessionPanelCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sessionPanelCollapsed]);

  const [llmSystemPrompt] = useState<string>(() => {
    try {
      return window.localStorage.getItem(LLM_SYSTEM_PROMPT_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const bailianModels = useMemo(() => voiceModelsForProvider(ttsProvider, clonedVoices), [ttsProvider, clonedVoices]);
  const bailianVoices: VoiceOpt[] = useMemo(() => voiceOptionsForProvider(ttsProvider, clonedVoices), [ttsProvider, clonedVoices]);

  useEffect(() => {
    if (ttsProvider === "cosyvoice") {
      if (!clonedVoicesLoaded) return;
      const selected = clonedVoices.find((voice) => voice.voice_id === qwenVoice) ?? clonedVoices[0];
      setQwenVoice(selected?.voice_id ?? "");
      if (selected) setQwenModel(selected.target_model);
      return;
    }
    const mids = bailianModels.map((o) => o.id);
    const vids = bailianVoices.map((o) => o.id);
    setQwenModel((prev) => (mids.includes(prev) ? prev : mids[0] ?? ""));
    if (vids.length === 0) {
      setQwenVoice("");
      return;
    }
    setQwenVoice((prev) => (vids.includes(prev) ? prev : vids[0] ?? ""));
  }, [ttsProvider, bailianModels, bailianVoices, clonedVoicesLoaded, clonedVoices, qwenVoice]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== remoteStream) {
      video.srcObject = remoteStream;
    }
    if (remoteStream) {
      video.muted = false;
      video.volume = 1;
      playWithMutedFallback(video);
    } else {
      video.muted = true;
    }
  }, [conversationViewMode, remoteStream, workflow]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!remoteStream) {
      audio.srcObject = null;
      return;
    }
    audio.srcObject = remoteStream;
    audio.muted = false;
    audio.volume = 1;
    void audio.play().catch(() => {});
    return () => {
      audio.srcObject = null;
    };
  }, [remoteStream]);

  useEffect(() => {
    return () => {
      if (ttsPreviewUrlRef.current) {
        URL.revokeObjectURL(ttsPreviewUrlRef.current);
        ttsPreviewUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(EDGE_VOICE_STORAGE_KEY, edgeVoice);
    } catch {
      /* ignore */
    }
  }, [edgeVoice]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TTS_PROVIDER_STORAGE_KEY, ttsProvider);
    } catch {
      /* ignore */
    }
  }, [ttsProvider]);

  useEffect(() => {
    try {
      window.localStorage.setItem(QWEN_MODEL_STORAGE_KEY, qwenModel);
    } catch {
      /* ignore */
    }
  }, [qwenModel]);

  useEffect(() => {
    try {
      window.localStorage.setItem(QWEN_VOICE_STORAGE_KEY, qwenVoice);
    } catch {
      /* ignore */
    }
  }, [qwenVoice]);

  useEffect(() => {
    if (!asrProvider) return;
    try {
      window.localStorage.setItem(ASR_PROVIDER_STORAGE_KEY, asrProvider);
    } catch {
      /* ignore */
    }
  }, [asrProvider]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LLM_SYSTEM_PROMPT_STORAGE_KEY, llmSystemPrompt);
    } catch {
      /* ignore */
    }
  }, [llmSystemPrompt]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_DOCK_EXPANDED_KEY, settingsExpanded ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [settingsExpanded]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(messageStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Message[];
      if (!Array.isArray(parsed)) return;
      setMessages(parsed);
      msgCounter = Math.max(msgCounter, parsed.length);
    } catch (error) {
      console.warn("Failed to restore chat history", error);
    }
  }, [messageStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(messageStorageKey, JSON.stringify(messages));
    } catch (error) {
      console.warn("Failed to persist chat history", error);
    }
  }, [messages, messageStorageKey]);

  const closePeerConnection = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (remoteStreamRef.current) {
      for (const track of remoteStreamRef.current.getTracks()) track.stop();
      remoteStreamRef.current = null;
    }
    setRemoteStream(null);
  }, []);

  const releaseSession = useCallback(async (sid: string, keepalive = false) => {
    try {
      await apiDelete(`/sessions/${sid}`, { keepalive });
      return true;
    } catch (error) {
      console.warn("Failed to release session", sid, error);
      return false;
    }
  }, []);

  const resetLiveState = useCallback(
    (clearMessages = false) => {
      closePeerConnection();
      setSessionId(null);
      setSessionKnowledge(null);
      setActiveAsrProvider("");
      setQueueInfo(null);
      setExpiringCountdown(null);
      slotAcquiredRef.current = null;
      clearSubtitleState();
      if (clearMessages) {
        setMessages([]);
      }
    },
    [clearSubtitleState, closePeerConnection],
  );

  const prewarmKey = useCallback((targetAvatarId: string, targetModel: string) => {
    return `${targetModel}:${targetAvatarId}`;
  }, []);

  const isPrewarmAssetReady = useCallback((response: AvatarPrewarmResponse) => {
    if (response.status === "ready") return true;
    const cacheStatus = String(response.cache?.status ?? "").trim().toLowerCase();
    return Boolean(cacheStatus && !["error", "failed", "missing", "skipped", "unknown"].includes(cacheStatus));
  }, []);

  const requestAvatarPrewarm = useCallback(async (
    targetAvatarId: string,
    targetModel: string,
    options?: { force?: boolean; modelConnected?: boolean },
  ): Promise<boolean> => {
    if (!targetAvatarId || !PREWARMABLE_MODELS.has(targetModel)) return true;
    if (!options?.modelConnected) return false;
    const key = prewarmKey(targetAvatarId, targetModel);
    const current = prewarmByKey[key];
    const inFlight = prewarmInFlightRef.current.get(key);
    if (inFlight) return inFlight;
    if (current === "ready") return true;
    if (current === "failed" && !options?.force) return false;
    const task = (async () => {
      const seq = ++prewarmSeqRef.current;
      setPrewarmByKey((prev) => ({ ...prev, [key]: "preparing" }));
      try {
        const response = await apiPost<AvatarPrewarmResponse>(
          `/avatars/${encodeURIComponent(targetAvatarId)}/prewarm`,
          { model: targetModel },
        );
        const ready = isPrewarmAssetReady(response);
        setPrewarmByKey((prev) => ({
          ...prev,
          [key]: ready ? "ready" : "failed",
        }));
        if (ready && seq === prewarmSeqRef.current) {
          const cacheStatus = response.cache?.status;
          const label = modelLabel(targetModel);
          if (response.runtime_status === "failed") {
            const detail = response.runtime?.message;
            notify(detail ? `${label} 资产已准备，运行时预热失败：${detail}` : `${label} 资产已准备，运行时预热失败。`, "info");
          } else {
            notify(cacheStatus ? `${label} 已准备：${cacheStatus}` : `${label} 已准备`, "success");
          }
        }
        return ready;
      } catch (error) {
        console.warn("Avatar prewarm failed", error);
        setPrewarmByKey((prev) => ({ ...prev, [key]: "failed" }));
        if (seq === prewarmSeqRef.current) {
          const detail = error instanceof ApiError ? error.detail : null;
          const label = modelLabel(targetModel);
          notify(detail ? `${label} 准备失败：${detail}` : `${label} 准备失败，首次生成会走冷启动。`, "error");
        }
        return false;
      } finally {
        prewarmInFlightRef.current.delete(key);
      }
    })();
    prewarmInFlightRef.current.set(key, task);
    return task;
  }, [isPrewarmAssetReady, notify, prewarmByKey, prewarmKey]);

  const selectedPrewarmState = prewarmByKey[prewarmKey(avatarId, model)] ?? "idle";

  useEffect(() => {
    if (!PREWARMABLE_MODELS.has(model) || !avatarId) return;
    void requestAvatarPrewarm(avatarId, model, { modelConnected: selectedModelConnected });
  }, [avatarId, model, requestAvatarPrewarm, selectedModelConnected]);

  // ---------- Init: fetch avatars & models ----------
  useEffect(() => {
    void (async () => {
      try {
        const [av, mo, health, initialRuntimeConfig] = await Promise.all([
          apiGet<AvatarSummary[]>("/avatars"),
          apiGet<{ models: string[]; statuses?: ModelStatus[]; default_model?: string | null }>("/models"),
          apiGet<HealthResponse>("/health"),
          loadRuntimeConfig().catch((error) => {
            console.warn("load runtime config during init failed", error);
            return null;
          }),
        ]);
        setRuntimeStatus(health);
        setAvatars(av);
        setModels(mo.models);
        if (initialRuntimeConfig) {
          setRuntimeConfig(initialRuntimeConfig);
          syncRuntimeConfigSelection(initialRuntimeConfig, true);
        } else {
          setAsrProvider((prev) => {
            const next = normalizeAsrProvider(prev || health.stt_provider, "dashscope");
            setAsrModel(sttModelForProvider(next));
            return next;
          });
        }
        const statuses = mo.statuses ?? mo.models.map((id) => ({ id, connected: true }));
        setModelStatuses(statuses);
        const storedAvatarSelection = readStoredAvatarSelection();
        const initialAvatar = pickInitialAvatar(av, mo.models, storedAvatarSelection, mo.default_model);
        if (initialAvatar) {
          setAvatarId(initialAvatar.id);
          if (initialAvatar.is_custom || storedAvatarSelection?.source === "explicit") {
            writeStoredAvatarId(
              initialAvatar.id,
              storedAvatarSelection?.source === "explicit" ? "explicit" : "auto",
            );
          }
          setModel((prev) => {
            const requestedModel = pickInitialModel(
              prev,
              mo.models,
              statuses,
              initialAvatar,
              mo.default_model,
            );
            return normalizeAvatarModelSelection(
              av,
              initialAvatar.id,
              requestedModel,
            ).model;
          });
        }
      } catch {
        setConnection("error");
      }
    })();
  }, [syncRuntimeConfigSelection]);

  // ---------- SSE ----------
  useEffect(() => {
    if (!sessionId) return;
    const stop = connectSse(buildApiUrl(`/sessions/${sessionId}/events`), (ev, data) => {
      if (ev === "session.queued" && data && typeof data === "object") {
        const d = data as { position?: number; message?: string };
        const position = d.position ?? 1;
        const message = d.message ?? "waiting";
        if (position > 0) {
          setConnection("queued");
          setQueueInfo({ position, message });
        } else if (position === 0) {
          // Slot acquired: unblock handleStart to proceed with WebRTC
          slotAcquiredRef.current?.();
          slotAcquiredRef.current = null;
          setConnection("connecting");
          setQueueInfo(null);
        } else {
          // -1: rejected (queue_full or timeout)
          slotAcquiredRef.current = null;
          setConnection("error");
          setQueueInfo({ position, message });
        }
      }
      if (ev === "session.expiring" && data && typeof data === "object") {
        const d = data as { remaining_sec?: number };
        const remaining = d.remaining_sec ?? 60;
        setConnection("expiring");
        setExpiringCountdown(remaining);
        // Start local countdown
        const interval = setInterval(() => {
          setExpiringCountdown((prev) => {
            if (prev === null || prev <= 1) {
              clearInterval(interval);
              return null;
            }
            return prev - 1;
          });
        }, 1000);
      }
      if (ev === "session.expired") {
        stopRealtimeRecording();
        cleanupRealtimeRecordStreams();
        closePeerConnection();
        remoteStreamRef.current = null;
        setRemoteStream(null);
        sessionIdRef.current = null;
        setConversationViewMode('studio');
        void membership.refresh();
        notify('本次对话时长已结束，录制将自动保存。可查看剩余额度后重新开始。', 'info');
        // Server force-closed the session, reset to idle
        setConnection("idle");
        setExpiringCountdown(null);
        setSessionId(null);
        setActiveAsrProvider("");
        const orphanId = streamingAssistantMsgIdRef.current;
        const pendingId = pendingAssistantMsgIdRef.current;
        clearSubtitleState();
        if (orphanId || pendingId) {
          const removeIds = new Set([orphanId, pendingId].filter(Boolean));
          setMessages((prev) => prev.filter((m) => !removeIds.has(m.id)));
        }
      }
      if (ev === "error") {
        const d = data && typeof data === "object" ? (data as { message?: string; code?: string }) : {};
        const detail = d.message || d.code || "语音合成失败，请切换可用音色后重试。";
        appendAssistantError(detail);
        notify(`对话失败：${detail}`, "error");
      }
      if (ev === "speech.started") {
        const sourceData = data && typeof data === "object" ? (data as { sources?: Message["sources"] }).sources : undefined;
        const sources = Array.isArray(sourceData) ? sourceData.filter(source => source && typeof source.filename === "string" && typeof source.doc_id === "string" && typeof source.kb_id === "string") : [];
        const staleId = streamingAssistantMsgIdRef.current;
        const pendingId = pendingAssistantMsgIdRef.current;
        clearSubtitleState();
        setIsSpeaking(true);
        if (staleId) {
          setMessages((prev) => prev.filter((m) => m.id !== staleId));
        }
        const id = pendingId ?? makeId();
        streamingAssistantMsgIdRef.current = id;
        setMessages((prev) => {
          if (prev.some((m) => m.id === id)) {
            return prev.map((m) => (m.id === id ? { ...m, text: "", sources } : m));
          }
          return [
            ...prev,
            { id, role: "assistant", text: "", timestamp: Date.now(), sources },
          ];
        });
      }
      if (ev === "knowledge.sources") {
        const sourceData = data && typeof data === "object" ? (data as { sources?: Message["sources"] }).sources : undefined;
        const sources = Array.isArray(sourceData) ? sourceData.filter(source => source && typeof source.filename === "string" && typeof source.doc_id === "string" && typeof source.kb_id === "string") : [];
        const id = streamingAssistantMsgIdRef.current;
        if (id) setMessages(previous => previous.map(message => message.id === id ? { ...message, sources } : message));
      }
      if (ev === "speech.media_started") {
        subtitleMediaReadyRef.current = true;
        clearSubtitleFallbackTimer();
        flushSubtitleDisplay();
        flushSubtitleMessage();
      }
      if (ev === "subtitle.chunk" && data && typeof data === "object") {
        const t = (data as { text?: string }).text;
        if (!t) return;
        subtitleAccRef.current += t;
        if (subtitleMediaReadyRef.current) {
          flushSubtitleDisplay();
          flushSubtitleMessage();
        }
      }
      if (ev === "speech.ended") {
        const d = data && typeof data === "object" ? (data as { text?: string }) : {};
        const fromEvent = typeof d.text === "string" ? d.text.trim() : "";
        const streamed = subtitleAccRef.current.trim();
        const finalText = fromEvent || streamed;
        const msgId = streamingAssistantMsgIdRef.current;
        clearSubtitleState();
        if (msgId) {
          if (finalText) {
            setMessages((prev) => {
              let updated = false;
              const next = prev.map((m) => {
                if (m.id !== msgId) return m;
                updated = true;
                return { ...m, text: finalText };
              });
              if (updated) return next;
              return [
                ...prev,
                { id: makeId(), role: "assistant", text: finalText, timestamp: Date.now() },
              ];
            });
          } else {
            setMessages((prev) => prev.filter((m) => m.id !== msgId));
          }
        } else if (finalText) {
          setMessages((prev) => [
            ...prev,
            { id: makeId(), role: "assistant", text: finalText, timestamp: Date.now() },
          ]);
        }
      }
    });
    return stop;
  }, [appendAssistantError, clearSubtitleFallbackTimer, clearSubtitleState, flushSubtitleDisplay, flushSubtitleMessage, notify, sessionId]);

  // Resolves when FlashTalk slot is acquired (session.queued position=0)
  const slotAcquiredRef = useRef<(() => void) | null>(null);

  const waitForSessionReady = useCallback(async (sid: string, timeoutMs = 180_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rec = await apiGet<SessionRecord>(`/sessions/${sid}`);
      if (rec.state === "worker_ready" || rec.state === "ready" || rec.state === "speaking") {
        return;
      }
      if (rec.state === "error" || rec.state === "closed") {
        throw new Error(`Session ${rec.state}`);
      }
      await wait(750);
    }
    throw new Error("Session init wait timeout");
  }, []);

  // ---------- Actions ----------
  const handleEndSession = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || sessionEnding) return false;
    setSessionEnding(true);
    speakAudioAbortRef.current?.abort();
    stopRealtimeRecording();
    cleanupRealtimeRecordStreams();
    sessionIdRef.current = null;
    resetLiveState();
    setConnection("idle");
    setConversationViewMode("studio");
    try {
      const released = await releaseSession(sid);
      notify(released ? "对话已结束，可重新开始。" : "本地连接已断开，但服务端会话释放失败，请检查服务状态。", released ? "success" : "error");
      return released;
    } finally {
      setSessionEnding(false);
    }
  }, [cleanupRealtimeRecordStreams, notify, releaseSession, resetLiveState, sessionEnding, stopRealtimeRecording]);

  const handleLogout = useCallback(async () => {
    if (!onLogout || logoutBusyRef.current) return;
    logoutBusyRef.current = true;
    recordingGenerationRef.current += 1;
    try {
      stopRealtimeRecording();
      await recordingCompletionRef.current;
      const pending = pendingRealtimeExportRef.current;
      if (pending) await uploadRealtimeExport(pending);
      if (pendingRealtimeExportRef.current) throw new Error("录制尚未保存成功，请重试保存后退出。");
      cleanupRealtimeRecordStreams();
      const sid = sessionIdRef.current;
      if (sid && !await releaseSession(sid)) throw new Error("会话释放失败，请稍后重试退出。");
      sessionIdRef.current = null;
      resetLiveState();
      setConnection("idle");
      await onLogout();
    } catch (error) {
      notify(error instanceof Error ? error.message : "退出失败，请重试。", "error");
    } finally { logoutBusyRef.current = false; }
  }, [cleanupRealtimeRecordStreams, notify, onLogout, releaseSession, resetLiveState, stopRealtimeRecording, uploadRealtimeExport]);

  const handleStart = useCallback(async () => {
    if (sessionEnding) return;
    if (!await membership.check(model)) return;
    if (voiceCloningBusyRef.current) { notify("专属声音正在处理，请完成后再开始对话。", "info"); return; }
    if (ttsProvider === "cosyvoice" && !resolveSelectableTtsVoice(ttsProvider, qwenVoice, bailianVoices)) {
      notify("请先创建或选择一个专属声音。", "info");
      return;
    }
    if (videoGenerating) { notify("请先等待视频生成完成，或停止生成任务。", "info"); return; }
    if (!videoRef.current) return;
    clearSubtitleState();
    const lockedAsrProvider = normalizeAsrProvider(asrProvider, "dashscope");
    let latestRuntimeStatus: HealthResponse | null = null;
    try {
      latestRuntimeStatus = await apiGet<HealthResponse>("/health");
      setRuntimeStatus(latestRuntimeStatus);
    } catch (error) {
      console.warn("Failed to refresh runtime status before start", error);
    }

    const startBlockReason = validateAudioProviderConfigBeforeStart({
      sttProvider: lockedAsrProvider,
      ttsProvider,
      runtimeStatus: latestRuntimeStatus,
    });
    if (startBlockReason) {
      notify(startBlockReason, "error");
      setSettingsExpanded(true);
      return;
    }

    if (PREWARMABLE_MODELS.has(model) && selectedModelConnected && selectedPrewarmState !== "ready") {
      const ready = await requestAvatarPrewarm(avatarId, model, { force: true, modelConnected: selectedModelConnected });
      if (!ready) return;
    }

    const previousSessionId = sessionIdRef.current;
    if (previousSessionId) {
      await releaseSession(previousSessionId);
      resetLiveState();
    }

    if (voiceCloningBusyRef.current) { notify("专属声音正在处理，请完成后再开始对话。", "info"); return; }
    setAsrProvider(lockedAsrProvider);
    setActiveAsrProvider(lockedAsrProvider);
    setAsrModel(sttModelForProvider(lockedAsrProvider));
    setConnection("connecting");
    setQueueInfo(null);
    let createdSessionId: string | null = null;
    try {
      const selectedTtsVoice = resolveSelectableTtsVoice(ttsProvider, qwenVoice, bailianVoices);
      const agentFields = knowledgeSessionFields(knowledgeBaseIds, explicitMemoryEnabled);
      const created = await apiPost<CreateSessionResponse>("/sessions", {

        avatar_id: avatarId,
        model,
        llm_system_prompt: llmSystemPrompt.trim() || undefined,
        tts_provider: ttsProvider,
        stt_provider: lockedAsrProvider,
        tts_voice: isEdgeTts(ttsProvider)
          ? edgeVoice
          : !hasSelectableTtsVoice(ttsProvider)
            ? undefined
            : selectedTtsVoice || undefined,
        tts_model: ttsModelSelectable(ttsProvider) ? qwenModel : undefined,
        user_id: account ? String(account.id) : "local",
        ...agentFields,
      } satisfies CreateSessionRequest);
      createdSessionId = created.session_id;
      setSessionId(created.session_id);
      setSessionKnowledge({ ids: agentFields.knowledge_base_ids, memoryEnabled: agentFields.memory_enabled });

      // Some backends return before the heavy model/avatar prepare is complete.
      if (created.status === "queued" || created.status === "initializing") {
        setConnection(created.status === "queued" ? "queued" : "connecting");
        try {
          const qs = await apiGet<{ slot_occupied: boolean; queue_size: number }>("/queue/status");
          if (created.status === "queued" && qs.slot_occupied) {
            setConnection("queued");
            setQueueInfo({ position: qs.queue_size, message: "waiting" });
          }
        } catch { /* ignore, SSE/polling will update */ }

        await Promise.race([
          waitForSessionReady(created.session_id),
          new Promise<void>((resolve, reject) => {
            slotAcquiredRef.current = resolve;
            const timer = setTimeout(() => {
              slotAcquiredRef.current = null;
              reject(new Error("Session init wait timeout"));
            }, 360_000);
            const origResolve = resolve;
            slotAcquiredRef.current = () => { clearTimeout(timer); origResolve(); };
          }),
        ]);
        slotAcquiredRef.current = null;
        setConnection("connecting");
        setQueueInfo(null);
      }

      closePeerConnection();
      const playback = await startPlayback(created.session_id, videoRef.current!, {
        onRemoteStream: (remoteStream) => {
          remoteStreamRef.current = remoteStream;
          setRemoteStream(remoteStream);
        },
      });
      pcRef.current = playback.pc;
      remoteStreamRef.current = playback.remoteStream;
      setRemoteStream(playback.remoteStream);
      setActiveAsrProvider(lockedAsrProvider);
      videoRef.current!.muted = false;
      setConnection("live");
      await apiPost(`/sessions/${created.session_id}/start`, {});
      notify("会话已连接，可以开始文本、语音或音频驱动。", "success");
      void membership.refresh();
    } catch (error) {
      if (createdSessionId) {
        await releaseSession(createdSessionId);
      }
      resetLiveState();
      console.warn("Failed to start session", error);
      setConnection("error");
      const detail = error instanceof ApiError ? error.detail : null;
      const msg = detail
        ? `启动会话失败：${detail}`
        : "启动会话失败，请稍后重试或查看后端日志。";
      notify(msg, "error");
    }
  }, [
    membership.check,
    membership.refresh,
    asrProvider,
    avatarId,
    bailianVoices,
    clientUserId,
    account,
    knowledgeBaseIds,
    explicitMemoryEnabled,
    clearSubtitleState,
    closePeerConnection,
    edgeVoice,
    llmSystemPrompt,
    model,
    notify,
    qwenVoice,
    releaseSession,
    requestAvatarPrewarm,
    resetLiveState,
    selectedModelConnected,
    selectedPrewarmState,
    ttsProvider,
    waitForSessionReady,
    qwenModel,
    videoGenerating,
    voiceCloningBusy,
    sessionEnding,
  ]);

  const handleReconnectKnowledge = useCallback(async () => {
    if (sessionEnding || connection === "connecting" || connection === "queued") return;
    if (ftRecordPhase === "recording" || recordingSaving || ftRecordBusy || pendingRealtimeExportRef.current) {
      notify("请先停止并保存录制，再重新连接应用设置。", "info");
      return;
    }
    if (videoGenerating || voiceCloningBusy) {
      notify("请先等待当前任务完成，再重新连接。", "info");
      return;
    }
    if (!await handleEndSession()) return;
    setWorkflow("realtime");
    setReconnectKnowledgeRequested(true);
  }, [connection, ftRecordBusy, ftRecordPhase, handleEndSession, notify, recordingSaving, sessionEnding, videoGenerating, voiceCloningBusy]);

  useEffect(() => {
    if (!reconnectKnowledgeRequested || sessionEnding || sessionId || workflow !== "realtime") return;
    setReconnectKnowledgeRequested(false);
    void handleStart();
  }, [handleStart, reconnectKnowledgeRequested, sessionEnding, sessionId, workflow]);

  const handleCreateCustomAvatar = useCallback(async (
    file: File,
    name: string,
    options?: { removeBackground?: boolean },
  ) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      notify("请先给形象起个名字。", "info");
      return;
    }
    try {
      window.localStorage.setItem(CUSTOM_REFERENCE_NAME_KEY, trimmedName);
    } catch {
      /* ignore */
    }
    setReferenceSaving(true);
    try {
      const fd = new FormData();
      fd.set("base_avatar_id", avatarId);
      fd.set("name", trimmedName);
      fd.set("model", model);
      fd.set("image", file);
      fd.set("remove_background", options?.removeBackground ? "true" : "false");
      const created = await apiPostForm<AvatarSummary>("/avatars/custom", fd);
      setAvatars((prev) => {
        const filtered = prev.filter((avatar) => avatar.id !== created.id);
        return [...filtered, created];
      });
      setAvatarId(created.id);
      writeStoredAvatarId(created.id);
      const sid = sessionIdRef.current;
      if (sid) await releaseSession(sid);
      resetLiveState(true);
      setConnection("idle");
      notify(`自定义形象「${created.name ?? trimmedName}」已加入形象库。`, "success");
      return created;
    } catch (e) {
      console.warn("create custom avatar failed", e);
      const detail = e instanceof ApiError ? e.detail : null;
      notify(detail ? `创建失败：${detail}` : "创建自定义形象失败，请查看后端日志。", "error");
      return null;
    } finally {
      setReferenceSaving(false);
    }
  }, [avatarId, model, notify, releaseSession, resetLiveState]);

  const handleDeleteAvatar = useCallback(
    async (target: AvatarSummary) => {
      try {
        await apiDelete(`/avatars/${encodeURIComponent(target.id)}`);
        setAvatars((prev) => prev.filter((a) => a.id !== target.id));
        // If the deleted avatar was selected, fall back to the first remaining one.
        setAvatarId((current) => {
          if (current !== target.id) return current;
          const remaining = avatars.filter((a) => a.id !== target.id);
          const next = remaining[0]?.id ?? "";
          writeStoredAvatarId(next);
          return next;
        });
        notify(`已删除自定义形象「${target.name ?? target.id}」。`, "success");
      } catch (error) {
        console.warn("delete avatar failed", error);
        const detail = error instanceof ApiError ? error.detail : null;
        notify(detail ? `删除失败：${detail}` : "删除失败，请查看后端日志。", "error");
      }
    },
    [avatars, notify],
  );

  const handleReturnToAvatarSelection = useCallback(() => {
    if (!window.confirm("更换数字人会结束当前会话，是否继续？")) return;
    void (async () => {
      const sid = sessionIdRef.current;
      if (sid) {
        await releaseSession(sid);
      }
      resetLiveState(true);
      setConnection("idle");
    })();
  }, [avatars, releaseSession, resetLiveState]);

  const handlePreviewTts = useCallback(async () => {
    const text = ttsPreviewText.trim();
    if (!text) {
      notify("先输入一句试听文本。", "info");
      return;
    }
    setTtsPreviewing(true);
    try {
      const voice = isEdgeTts(ttsProvider)
        ? edgeVoice
        : resolveSelectableTtsVoice(ttsProvider, qwenVoice, bailianVoices);
      if (hasSelectableTtsVoice(ttsProvider) && !voice.trim()) {
        notify("当前模型没有可用音色，请先复刻音色或切换模型。", "info");
        return;
      }
      const blob = await requestTTSPreview(
        buildTTSPreviewPayload({
          text,
          voice,
          provider: ttsProvider,
          model: qwenModel,
        }),
      );
      if (ttsPreviewUrlRef.current) {
        URL.revokeObjectURL(ttsPreviewUrlRef.current);
      }
      const url = URL.createObjectURL(blob);
      ttsPreviewUrlRef.current = url;
      const audio = ttsPreviewAudioRef.current ?? new Audio();
      ttsPreviewAudioRef.current = audio;
      audio.src = url;
      await audio.play();
      notify("正在播放试听音频。", "success");
    } catch (e) {
      console.warn("tts preview failed", e);
      const detail = apiErrorMessage(e, "请确认音色、模型和后端密钥配置。");
      notify(`试听失败：${detail}`, "error");
    } finally {
      setTtsPreviewing(false);
    }
  }, [bailianVoices, edgeVoice, notify, qwenModel, qwenVoice, ttsPreviewText, ttsProvider]);

  const handleSend = useCallback(
    (text: string) => {
      if (!sessionId || !text) return;
      const pendingId = makeId();
      const activeAssistantId = streamingAssistantMsgIdRef.current;
      const previousPendingId = pendingAssistantMsgIdRef.current;
      pendingAssistantMsgIdRef.current = pendingId;
      setIsSpeaking(true);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== previousPendingId && m.id !== activeAssistantId),
        { id: makeId(), role: "user", text, timestamp: Date.now() },
        { id: pendingId, role: "assistant", text: "正在合成语音和口型...", timestamp: Date.now() },
      ]);
      if (isSpeaking) {
        void apiPost(`/sessions/${sessionId}/interrupt`, {}).catch(() => {});
      }
      const endpoint = "speak";
      const selectedTtsVoice = resolveSelectableTtsVoice(ttsProvider, qwenVoice, bailianVoices);
      const payload = {
        text,
        voice:
          isEdgeTts(ttsProvider)
            ? edgeVoice
            : !hasSelectableTtsVoice(ttsProvider)
              ? undefined
              : selectedTtsVoice || undefined,
        tts_provider: ttsProvider,
        tts_model: ttsModelSelectable(ttsProvider) ? qwenModel : undefined,
      };
      void apiPost(`/sessions/${sessionId}/${endpoint}`, payload).catch((err) => {
        console.warn(`${endpoint} failed`, err);
        const detail = apiErrorMessage(err, "请确认会话仍处于已连接状态。");
        appendAssistantError(`发送失败：${detail}`);
        notify(`发送失败：${detail}`, "error");
      });
    },
    [appendAssistantError, bailianVoices, edgeVoice, isSpeaking, notify, qwenModel, qwenVoice, sessionId, ttsProvider],
  );

  /** 流式 STT（WebSocket PCM）成功后仅追加本地消息（speak 已由后端入队） */
  const handleSpeakAudioStreamResult = useCallback(({ text }: { text: string }) => {
    setMessages((prev) => [
      ...prev,
      { id: makeId(), role: "user", text, timestamp: Date.now() },
    ]);
  }, []);

  const handleSpeakAudioStreamError = useCallback((message: string) => {
    const detail = message || "语音识别失败，请检查 STT 配置。";
    appendAssistantError(`语音识别失败：${detail}`);
    notify(`语音识别失败：${detail}`, "error");
  }, [appendAssistantError, notify]);

  const handleSpeakAudio = useCallback(
    async (blob: Blob) => {
      if (!sessionId) return;
      speakAudioAbortRef.current?.abort();
      const ac = new AbortController();
      speakAudioAbortRef.current = ac;
      const fd = new FormData();
      fd.append("file", blob, "speech.webm");
      fd.append(
        "voice",
        isEdgeTts(ttsProvider)
          ? edgeVoice
          : resolveSelectableTtsVoice(ttsProvider, qwenVoice, bailianVoices),
      );
      fd.append("tts_provider", ttsProvider);
      fd.append("stt_provider", activeAsrProvider || normalizeAsrProvider(asrProvider, "dashscope"));
      if (ttsModelSelectable(ttsProvider)) {
        fd.append("tts_model", qwenModel);
      }
      try {
        const res = await apiPostForm<SpeakAudioResponse>(
          `/sessions/${sessionId}/speak_audio`,
          fd,
          { signal: ac.signal },
        );
        setMessages((prev) => [
          ...prev,
          { id: makeId(), role: "user", text: res.text, timestamp: Date.now() },
        ]);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // 勿将 connection 置为 error，否则会重新出现「开始 Demo」全屏遮罩
        console.warn("speak_audio failed", error);
        const detail = apiErrorMessage(error, "请检查 STT 配置和后端日志。");
        appendAssistantError(`语音识别失败：${detail}`);
        notify(`语音识别失败：${detail}`, "error");
      } finally {
        if (speakAudioAbortRef.current === ac) {
          speakAudioAbortRef.current = null;
        }
      }
    },
    [activeAsrProvider, appendAssistantError, asrProvider, bailianVoices, edgeVoice, notify, qwenModel, qwenVoice, sessionId, ttsProvider],
  );

  const handleInterrupt = useCallback(() => {
    speakAudioAbortRef.current?.abort();
    if (!sessionId) return;
    void apiPost(`/sessions/${sessionId}/interrupt`, {}).catch(() => {});
  }, [sessionId]);

  const handleSpeakFlashtalkAudioFile = useCallback(
    async (file: File) => {
      if (!sessionId || !isFlashRenderer(model)) return;
      const fd = new FormData();
      fd.append("file", file);
      try {
        await apiPostForm<{ session_id: string; status: string }>(
          `/sessions/${sessionId}/speak_flashtalk_audio`,
          fd,
        );
        setMessages((prev) => [
          ...prev,
          {
            id: makeId(),
            role: "user",
            text: `[上传音频] ${file.name}`,
            timestamp: Date.now(),
          },
        ]);
      } catch (error) {
        console.warn("speak_flashtalk_audio failed", error);
        notify("上传音频驱动口型失败，请确认文件格式和当前会话状态。", "error");
      }
    },
    [model, notify, sessionId],
  );

  useEffect(() => {
    if (realtimeRecorderRef.current?.state === "recording") {
      realtimeRecorderRef.current.stop();
    }
    cleanupRealtimeRecordStreams();
    setFtRecordPhase("idle");
  }, [cleanupRealtimeRecordStreams, sessionId, model]);

  useEffect(() => {
    if (connection !== "live" && connection !== "expiring") {
      if (realtimeRecorderRef.current?.state === "recording") {
        realtimeRecorderRef.current.stop();
      }
      cleanupRealtimeRecordStreams();
      setFtRecordPhase("idle");
    }
  }, [cleanupRealtimeRecordStreams, connection]);

  const handleFtRecordStart = useCallback(async () => {
    await startRealtimeRecording();
  }, [startRealtimeRecording]);

  const handleFtRecordStop = useCallback(() => {
    stopRealtimeRecording();
  }, [stopRealtimeRecording]);

  const handleFtRecordSave = useCallback(async () => {
    await retryPendingRealtimeExport();
  }, [retryPendingRealtimeExport]);

  const handleAvatarChange = useCallback(
    (newId: string) => {
      clearSubtitleState();
      const normalized = normalizeAvatarModelSelection(avatars, newId, model);
      setAvatarId(normalized.avatarId);
      writeStoredAvatarId(normalized.avatarId);
      const requestedModel = normalized.model;
      if (requestedModel !== model) {
        setModel(requestedModel);
        notify("该形象使用免 GPU 浏览器动画，已切换到轻量模式。", "info");
      }
      void (async () => {
        const sid = sessionIdRef.current;
        if (sid) {
          await releaseSession(sid);
        }
        resetLiveState(true);
        setConnection("idle");
      })();
    },
    [avatars, clearSubtitleState, model, notify, releaseSession, resetLiveState],
  );

  const handleAvatarUploaded = useCallback(
    (created: AvatarSummary) => {
      setAvatars((prev) => {
        const filtered = prev.filter((avatar) => avatar.id !== created.id);
        return [...filtered, created];
      });
      handleAvatarChange(created.id);
    },
    [handleAvatarChange],
  );

  const handleModelChange = useCallback((newModel: string) => {
    const currentAvatar = avatars.find((avatar) => avatar.id === avatarId) ?? null;
    if (!canChangeModelForAvatar(currentAvatar, newModel)) {
      notify("博士小狗仅支持轻量模式，请先更换形象。", "info");
      return;
    }
    clearSubtitleState();
    setModel(newModel);
    const nextAvatarId = recommendAvatarForModel(avatars, newModel, avatarId);
    if (nextAvatarId !== avatarId) {
      setAvatarId(nextAvatarId);
      writeStoredAvatarId(nextAvatarId, "auto");
    }
    void (async () => {
      const sid = sessionIdRef.current;
      if (sid) {
        await releaseSession(sid);
      }
      resetLiveState();
      setConnection("idle");
    })();
  }, [avatarId, avatars, clearSubtitleState, notify, releaseSession, resetLiveState]);

  useEffect(() => {
    const handlePageHide = () => {
      const sid = sessionIdRef.current;
      if (realtimeRecorderRef.current?.state === "recording") {
        realtimeRecorderRef.current.stop();
      }
      cleanupRealtimeRecordStreams();
      if (sid) {
        void releaseSession(sid, true);
      }
      closePeerConnection();
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [cleanupRealtimeRecordStreams, closePeerConnection, releaseSession]);

  useEffect(() => {
    workspaceActiveRef.current = true;
    return () => {
      workspaceActiveRef.current = false;
      recordingGenerationRef.current += 1;
      stopRealtimeRecording();
      cleanupRealtimeRecordStreams();
      speakAudioAbortRef.current?.abort();
      const sid = sessionIdRef.current;
      if (sid) {
        void releaseSession(sid, true);
      }
      closePeerConnection();
    };
  }, [cleanupRealtimeRecordStreams, closePeerConnection, releaseSession, stopRealtimeRecording]);

  const currentAvatar = avatars.find((a) => a.id === avatarId) ?? null;
  const sessionConfigLocked = connection === "connecting" || connection === "queued" || connection === "live" || connection === "expiring";
  const knowledgeReconnectReason = sessionEnding || connection === "connecting" || connection === "queued"
    ? "请等待当前连接操作完成。"
    : ftRecordPhase === "recording" || recordingSaving || ftRecordBusy || pendingRealtimeExportRef.current
      ? "请先停止并保存录制，再重新连接。"
      : videoGenerating || voiceCloningBusy ? "请等待当前任务完成后再重新连接。" : undefined;
  const showStart = connection === "idle" || connection === "error" || connection === "connecting" || connection === "queued";
  const effectiveConversationViewMode = showStart ? "studio" : conversationViewMode;
  const immersiveActive = workflow === "realtime" && effectiveConversationViewMode === "immersive";
  const chatMaxVisible = readChatMaxVisible();
  const selectedModelLabel = modelLabel(model);
  const selectedVoiceLabel = isEdgeTts(ttsProvider)
    ? EDGE_ZH_VOICES.find((voice) => voice.id === edgeVoice)?.label ?? edgeVoice
    : bailianVoices.find((voice) => voice.id === qwenVoice)?.label ?? (qwenVoice || "暂无音色");
  const runtimeConfigReady = Boolean(runtimeConfig?.llm.api_key_set && runtimeConfig.stt.api_key_set
    && (runtimeConfig.tts.provider === "edge" || runtimeConfig.tts.api_key_set));
  return (
    <><div ref={workbenchRef} aria-hidden={personalOpen && account?.role === 'user' ? true : undefined} className="min-h-screen bg-slate-100 text-slate-900 lg:h-screen lg:overflow-hidden">
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      <TopBar
        onMembership={account?.role === 'user' && billingEnabled ? () => membership.setOpen(true) : undefined}
        membershipLabel={membership.account?.vip ? 'VIP · 我的额度' : '会员与额度'}
        accountLabel={account ? accountDisplayName(account, profile) : undefined}
        accountAvatar={profileAvatarSrc(profile?.avatar_url)}
        onAccount={account?.role === 'user' ? () => { membership.setOpen(false); navigatePersonal(true); } : undefined}
        canManageSettings={!account || account.role === "admin"}
        onLogout={onLogout ? () => void handleLogout() : undefined}
        connection={connection}
        workflow={workflow}
        conversationViewMode={effectiveConversationViewMode}
        immersiveChrome={immersiveActive}
        flashtalkRecording={!!sessionId && (connection === "live" || connection === "expiring")}
        flashtalkRecordPhase={ftRecordPhase}
        flashtalkRecordBusy={ftRecordBusy}
        recordingSaving={recordingSaving}
        runtimeConfigReady={runtimeConfigReady}
        runtimeConfigLoading={runtimeConfigLoading}
        sessionEnding={sessionEnding}
        onEndSession={() => void handleEndSession()}
        onConversationViewModeChange={setConversationViewMode}
        onWorkflowChange={(next) => {
          if (next === "runtimeConfig" && account?.role === "user") return;
          if (voiceCloningBusy && next !== workflow) {
            notify("专属声音正在处理，请稍候。", "info");
            return;
          }
          if (videoGenerating && next !== workflow) {
            notify("视频正在生成，请等待完成或先点击停止生成。", "info");
            return;
          }
          setWorkflow(next);
        }}
        onFlashtalkRecordStart={() => void handleFtRecordStart()}
        onFlashtalkRecordStop={() => void handleFtRecordStop()}
        onFlashtalkRecordSave={() => void handleFtRecordSave()}
      />


      {membership.open && !personalOpen && <MembershipDialog account={membership.account} error={membership.error} onClose={() => membership.setOpen(false)} onRefresh={membership.refresh} />}
      {expiringCountdown !== null && (
        <div className="fixed right-4 top-16 z-30 flex items-center gap-2 rounded-lg bg-amber-500/95 px-4 py-2.5 text-sm font-medium text-white shadow-lg backdrop-blur-sm">
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0z" />
          </svg>
          体验即将到期，剩余 <span className="tabular-nums font-bold">{expiringCountdown}</span> 秒
        </div>
      )}

      {workflow === "knowledge" ? (
        <div className="flex min-h-0 lg:h-[calc(100vh-3.5rem)]">
          <KnowledgeWorkspace selectedIds={knowledgeBaseIds} onSelectedIds={setKnowledgeBaseIds} memoryEnabled={explicitMemoryEnabled} onMemoryEnabled={setExplicitMemoryEnabled} sessionLive={Boolean(sessionId)} applied={sessionKnowledge} onGoChat={() => setWorkflow("realtime")} onReconnect={() => void handleReconnectKnowledge()} reconnectDisabled={Boolean(knowledgeReconnectReason)} reconnectReason={knowledgeReconnectReason} />
        </div>
      ) : workflow === "assetLibrary" ? (
        <div className="flex min-h-0 lg:h-[calc(100vh-3.5rem)]">
          <AssetLibraryWorkspace refreshToken={assetLibraryRefreshKey} onNotify={notify} />
        </div>
      ) : workflow === "videoCreation" ? (
        <div className="flex min-h-0 lg:h-[calc(100vh-3.5rem)]">
          <VideoCreationWorkspace
            onBeforeGenerate={() => membership.check('video')}
            onBillingRefresh={membership.refresh}
            avatars={avatars}
            avatarId={avatarId}
            models={models}
            onAvatarChange={handleAvatarChange}
            onAvatarUploaded={handleAvatarUploaded}
            sessionLive={Boolean(sessionId)}
            onGeneratingChange={setVideoGenerating}
            onExportCreated={() => setAssetLibraryRefreshKey((value) => value + 1)}
            onGoAssetLibrary={() => setWorkflow("assetLibrary")}
            onNotify={notify}
            ttsProvider={ttsProvider}
            onTtsProviderChange={setTtsProvider}
            qwenModel={qwenModel}
            onQwenModelChange={setQwenModel}
            qwenModelOptions={bailianModels}
            qwenVoice={qwenVoice}
            onQwenVoiceChange={setQwenVoice}
            qwenVoiceOptions={bailianVoices}
            edgeVoice={edgeVoice}
            onEdgeVoiceChange={setEdgeVoice}
          />
        </div>
      ) : workflow === "runtimeConfig" ? (
        <div className="flex min-h-0 lg:h-[calc(100vh-3.5rem)]">
          <RuntimeConfigWorkspace
            runtimeConfig={runtimeConfig}
            runtimeConfigLoading={runtimeConfigLoading}
            runtimeConfigApplying={runtimeConfigApplying}
            onRuntimeConfigRefresh={() => void refreshRuntimeConfig()}
            onRuntimeConfigApply={handleApplyRuntimeConfig}
          />
        </div>
      ) : (
      <div
        className={
          immersiveActive
            ? "relative flex h-dvh min-h-0 flex-col bg-slate-950"
            : "flex min-h-0 flex-col lg:h-[calc(100vh-3.5rem)] lg:flex-row"
        }
      >
        <div className={`${immersiveActive ? "hidden" : "order-2 min-h-0 lg:order-none lg:h-full lg:shrink-0"}`}>
          <SettingsPanel
            onMembership={account?.role === 'user' && billingEnabled ? () => membership.setOpen(true) : undefined}
            membershipLabel={membership.account?.unlimited ? '月度 VIP · 对话和视频不限总时长' : membership.account ? `QuickTalk 体验 ${membership.account.trials_remaining} 次 · 对话 ${minutes(membership.account.conversation_seconds)} · 视频 ${minutes(membership.account.video_seconds)}` : membership.error || undefined}
            expanded={settingsExpanded}
            onExpandedChange={setSettingsExpanded}
            avatars={avatars}
            models={models}
            modelStatuses={modelStatuses}
            avatarId={avatarId}
            model={model}
            modelConnected={selectedModelConnected}
            onModelChange={handleModelChange}
            edgeVoice={edgeVoice}
            onEdgeVoiceChange={setEdgeVoice}
            edgeVoiceOptions={EDGE_ZH_VOICES}
            ttsProvider={ttsProvider}
            onTtsProviderChange={setTtsProvider}
            qwenModel={qwenModel}
            onQwenModelChange={setQwenModel}
            qwenModelOptions={bailianModels}
            qwenVoice={qwenVoice}
            onQwenVoiceChange={setQwenVoice}
            qwenVoiceOptions={bailianVoices}
            ttsPreviewText={ttsPreviewText}
            onTtsPreviewTextChange={setTtsPreviewText}
            onPreviewTts={() => void handlePreviewTts()}
            ttsPreviewing={ttsPreviewing}
            asrModel={asrModel}
            configLocked={sessionConfigLocked}
            voiceCloneProps={{
              voices: clonedVoices,
              selectedVoice: ttsProvider === "cosyvoice" ? qwenVoice : "",
              locked: sessionConfigLocked,
              loading: clonedVoicesLoading,
              loadError: clonedVoicesError,
              onRetry: () => void refreshClonedVoices(),
              onCreated: handleVoiceCreated,
              onDeleted: handleVoiceDeleted,
              onUse: useClonedVoice,
              onBusyChange: handleVoiceBusyChange,
            }}
          />
        </div>

        <main
          className={
            immersiveActive
              ? "order-1 flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950 lg:order-none"
              : "order-1 flex min-h-0 flex-1 flex-col bg-slate-100 lg:order-none"
          }
        >
          <div
            className={
              immersiveActive
                ? "relative flex min-h-0 flex-1 flex-col overflow-hidden"
                : "flex min-h-0 flex-1 flex-col p-4"
            }
          >
            <div
              className={
                immersiveActive
                  ? "absolute inset-x-0 top-0 bottom-12 overflow-hidden bg-black sm:bottom-14"
                  : "relative min-h-[360px] flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/70 lg:min-h-[420px]"
              }
            >
              <SceneStage
                videoRef={videoRef}
                recordingCanvasRef={recordingCanvasRef}
                videoStream={remoteStream}
                scene={null}
                backgrounds={[]}
                subtitle={!showStart ? currentSubtitle : null}
                avatarMaskUrl={null}
                avatarAdjust={immersiveActive ? immersiveAvatarAdjust : undefined}
                compactSquareStage={compactSquareStage}
                clientRenderer={!showStart && model === "mock" ? currentAvatar?.client_renderer ?? null : null}
                className="h-full w-full"
              >
                {immersiveActive ? (
                  <>
                    <div className="absolute right-0 top-0 z-30 flex h-24 w-48 items-start justify-end p-4">
                      <button
                        type="button"
                        onClick={() => setConversationViewMode("studio")}
                        className="rounded-lg border border-white/15 bg-slate-950/45 px-3 py-2 text-xs font-semibold text-white opacity-0 shadow-lg backdrop-blur transition hover:bg-slate-950/65 hover:opacity-100 focus:opacity-100"
                      >
                        返回工作台
                      </button>
                    </div>
                    <div className="group absolute right-0 top-1/2 z-30 flex -translate-y-1/2 translate-x-[calc(100%-1.25rem)] items-center transition-transform duration-200 hover:translate-x-0 focus-within:translate-x-0">
                      <div className="flex h-20 w-5 items-center justify-center rounded-l-lg border border-r-0 border-slate-700 bg-slate-950 text-[10px] font-semibold text-white shadow-lg">
                        微调
                      </div>
                      <div className="w-64 rounded-l-xl border border-slate-700 bg-slate-950 p-4 text-white shadow-2xl shadow-slate-950/30">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold">画面微调</p>
                          <button
                            type="button"
                            onClick={() => setImmersiveAvatarAdjust({ x: 0, y: 0, scale: 1 })}
                            className="rounded-md border border-white/15 px-2 py-1 text-xs font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
                          >
                            重置
                          </button>
                        </div>
                        <label className="mb-3 block text-xs font-medium text-white/80">
                          <span className="mb-1 flex justify-between">
                            <span>水平</span>
                            <span className="tabular-nums">{immersiveAvatarAdjust.x}px</span>
                          </span>
                          <input
                            type="range"
                            min="-480"
                            max="480"
                            step="4"
                            value={immersiveAvatarAdjust.x}
                            onChange={(event) => setImmersiveAvatarAdjust((prev) => ({ ...prev, x: Number(event.target.value) }))}
                            className="w-full accent-cyan-300"
                          />
                        </label>
                        <label className="mb-3 block text-xs font-medium text-white/80">
                          <span className="mb-1 flex justify-between">
                            <span>垂直</span>
                            <span className="tabular-nums">{immersiveAvatarAdjust.y}px</span>
                          </span>
                          <input
                            type="range"
                            min="-320"
                            max="320"
                            step="4"
                            value={immersiveAvatarAdjust.y}
                            onChange={(event) => setImmersiveAvatarAdjust((prev) => ({ ...prev, y: Number(event.target.value) }))}
                            className="w-full accent-cyan-300"
                          />
                        </label>
                        <label className="block text-xs font-medium text-white/80">
                          <span className="mb-1 flex justify-between">
                            <span>缩放</span>
                            <span className="tabular-nums">{immersiveAvatarAdjust.scale.toFixed(2)}x</span>
                          </span>
                          <input
                            type="range"
                            min="0.4"
                            max="2.2"
                            step="0.02"
                            value={immersiveAvatarAdjust.scale}
                            onChange={(event) => setImmersiveAvatarAdjust((prev) => ({ ...prev, scale: Number(event.target.value) }))}
                            className="w-full accent-cyan-300"
                          />
                        </label>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="absolute left-4 right-4 top-4 z-30 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm">
                        <span className={`h-1.5 w-1.5 rounded-full ${
                          connection === "live" || connection === "expiring" ? "bg-emerald-500" : "bg-slate-400"
                        }`} />
                        {connection === "live" || connection === "expiring" ? "已连接" : "待启动"}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-medium text-cyan-700 shadow-sm">
                        WebRTC 舞台
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm">
                        {modelLabel(model)}
                      </span>
                      <span className="inline-flex max-w-[14rem] items-center gap-1 truncate rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm">
                        {currentAvatar?.name ?? currentAvatar?.id ?? "未选形象"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleReturnToAvatarSelection}
                      className="shrink-0 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-cyan-200 hover:text-cyan-700"
                    >
                      更换形象
                    </button>
                  </div>
                )}
              </SceneStage>

              {showStart ? (
                <div className="absolute inset-0 z-40 bg-white">
                  <AvatarSelectionStage
                    avatars={avatars}
                    selectedAvatar={currentAvatar}
                    selectedModelLabel={selectedModelLabel}
                    selectedVoiceLabel={selectedVoiceLabel}
                    loading={connection === "connecting"}
                    queued={connection === "queued"}
                    modelConnected={selectedModelConnected}
                    modelBadge={selectedModelBadge}
                    queueInfo={queueInfo}
                    prewarmState={selectedPrewarmState}
                    onAvatarChange={handleAvatarChange}
                    onStart={() => void handleStart()}
                    onCustomAvatarCreate={(file, name, options) => handleCreateCustomAvatar(file, name, options)}
                    onAvatarDelete={(target) => void handleDeleteAvatar(target)}
                    referenceSaving={referenceSaving}
                  />
                </div>
              ) : null}
            </div>

            {connection === "live" || connection === "expiring" ? (
            <div
              className={
                immersiveActive
                  ? "group absolute inset-x-3 bottom-0 z-30 mx-auto max-w-4xl translate-y-[calc(100%-1.25rem)] pb-3 transition-transform duration-200 hover:translate-y-0 focus-within:translate-y-0 sm:pb-5"
                  : "mt-4"
              }
            >
              {immersiveActive ? (
                <div className="pointer-events-none mb-2 flex justify-center opacity-100 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0">
                  <div className="h-1.5 w-16 rounded-full bg-white/80 shadow-sm" />
                </div>
              ) : null}
              <div className="mb-2"><SessionKnowledgeStatus applied={sessionKnowledge} selectedIds={knowledgeBaseIds} memoryEnabled={explicitMemoryEnabled} live={Boolean(sessionId)} onManage={() => setWorkflow("knowledge")} onReconnect={() => void handleReconnectKnowledge()} reconnectDisabled={Boolean(knowledgeReconnectReason)} reconnectReason={knowledgeReconnectReason} /></div>
              <ChatInput
                onSend={handleSend}
                onSpeakAudio={handleSpeakAudio}
                onSpeakFlashtalkAudioFile={
                  isFlashRenderer(model) ? handleSpeakFlashtalkAudioFile : undefined
                }
                streamingAsrSessionId={sessionId}
                onSpeakAudioStreamResult={handleSpeakAudioStreamResult}
                onSpeakAudioStreamError={handleSpeakAudioStreamError}
                onInterrupt={handleInterrupt}
                isSpeaking={isSpeaking}
                disabled={connection !== "live" && connection !== "expiring"}
                onNotify={notify}
                onOpenSettings={() => setSettingsExpanded(true)}
                ttsProvider={ttsProvider}
                sttProvider={activeAsrProvider}
                edgeVoice={edgeVoice}
                qwenModel={qwenModel}
                qwenVoice={qwenVoice}
              />
            </div>
            ) : null}
          </div>
        </main>

        <aside
          className={
            immersiveActive
              ? "hidden"
              : `order-3 min-h-0 overflow-hidden border-l border-slate-200 bg-white transition-[width] duration-200 lg:shrink-0 ${
                  sessionPanelCollapsed ? "lg:w-12" : "lg:w-[360px]"
                }`
          }
        >
          <div className="flex h-full min-h-0">
            <div className="flex w-12 shrink-0 flex-col items-center justify-center gap-4 border-r border-slate-100 bg-slate-50 py-3">
              <button
                type="button"
                onClick={() => setSessionPanelCollapsed((prev) => !prev)}
                aria-label={sessionPanelCollapsed ? "展开会话面板" : "折叠会话面板"}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-cyan-200 hover:text-cyan-700"
              >
                <svg
                  className={`h-4 w-4 transition-transform ${sessionPanelCollapsed ? "rotate-180" : ""}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M12.7 4.3a1 1 0 0 1 0 1.4L8.41 10l4.3 4.3a1 1 0 0 1-1.42 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.42 0z" />
                </svg>
              </button>
              <span className="[writing-mode:vertical-rl] text-xs font-semibold tracking-normal text-slate-500">
                会话面板
              </span>
            </div>
            <div className={`${sessionPanelCollapsed ? "hidden" : "flex"} min-w-0 flex-1 flex-col`}>
              <div className="border-b border-slate-200 px-4 pt-4">
                <p className="text-xs font-medium text-slate-500">会话面板</p>
                <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                  {PANEL_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setPanelTab(tab.id)}
                      className={`rounded-md px-2 py-1.5 text-xs font-medium ${
                        panelTab === tab.id ? "bg-white text-cyan-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-[22rem] overflow-y-auto p-4 lg:h-[calc(100%-5.75rem)]">
                {panelTab === "chat" ? (
                  <div className="flex h-full min-h-0 flex-col gap-3"><SessionKnowledgeStatus applied={sessionKnowledge} selectedIds={knowledgeBaseIds} memoryEnabled={explicitMemoryEnabled} live={Boolean(sessionId)} onManage={() => setWorkflow("knowledge")} onReconnect={() => void handleReconnectKnowledge()} reconnectDisabled={Boolean(knowledgeReconnectReason)} reconnectReason={knowledgeReconnectReason} /><div className="min-h-0 flex-1"><ChatMessages messages={messages} maxVisible={chatMaxVisible} /></div></div>
                ) : null}
                {panelTab === "status" ? (
                  <div className="space-y-3">
                    {[
                      ["连接状态", connection === "live" ? "已连接" : connection === "expiring" ? "即将到期" : connection === "queued" ? "排队中" : connection === "connecting" ? "连接中" : connection === "error" ? "连接错误" : "未连接"],
                      ["当前会话", sessionId ?? "未创建"],
                      ["数字人", currentAvatar?.name ?? currentAvatar?.id ?? "等待加载"],
                      ["驱动模型", modelLabel(model)],
                      ["语音线路", ttsProvider],
                      ["排队信息", queueInfo ? `${queueInfo.position} · ${queueInfo.message}` : "无排队"],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-medium text-slate-500">{label}</p>
                        <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {panelTab === "exports" ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-900">实时录制</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">
                        当前状态：{ftRecordPhase === "idle" ? "未录制" : ftRecordPhase === "recording" ? "录制中" : "待保存"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs leading-relaxed text-cyan-800">
                      音频驱动数字人会话连接后，可在顶部使用录制保存当前实时画面。
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </aside>
      </div>
      )}
      <ToastStack toasts={toasts} onDismiss={dismissToast} onPause={pauseToast} onResume={resumeToast} />
    </div>
    {personalOpen && account?.role === 'user' && <PersonalCenter account={account} profile={profile} profileError={profileError} onProfileChange={setProfile} onReloadProfile={() => setProfileAttempt(value => value + 1)} entitlements={membership.account} billingError={membership.error} billingEnabled={billingEnabled} onRefreshBilling={membership.refresh} onClose={() => navigatePersonal(false)} />}
    </>
  );
}
