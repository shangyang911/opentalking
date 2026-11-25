import type { ConnectionStatus } from "../shared/types";

const DOT_COLORS: Record<ConnectionStatus, string> = {
  idle: "bg-slate-500",
  connecting: "bg-yellow-500 animate-pulse-dot",
  queued: "bg-amber-500 animate-pulse-dot",
  live: "bg-green-500",
  expiring: "bg-amber-500",
  error: "bg-red-500",
};

const PILL_COLORS: Record<ConnectionStatus, string> = {
  idle: "border-slate-200 bg-slate-50 text-slate-600",
  connecting: "border-yellow-200 bg-yellow-50 text-yellow-700",
  queued: "border-amber-200 bg-amber-50 text-amber-700",
  live: "border-emerald-200 bg-emerald-50 text-emerald-700",
  expiring: "border-amber-200 bg-amber-50 text-amber-700",
  error: "border-red-200 bg-red-50 text-red-700",
};

const DOT_LABELS: Record<ConnectionStatus, string> = {
  idle: "未连接",
  connecting: "连接中",
  queued: "排队中",
  live: "已连接",
  expiring: "即将到期",
  error: "连接错误",
};

export type FlashtalkRecordPhase = "idle" | "recording" | "stopped";
export type StudioWorkflow = "realtime" | "videoCreation" | "assetLibrary" | "runtimeConfig" | "knowledge";
export type ConversationViewMode = "studio" | "immersive";

interface TopBarProps {
  membershipLabel?: string;
  onMembership?: () => void;
  accountLabel?: string;
  accountAvatar?: string;
  onAccount?: () => void;
  canManageSettings?: boolean;
  onLogout?: () => void;
  connection: ConnectionStatus;
  workflow?: StudioWorkflow;
  conversationViewMode?: ConversationViewMode;
  immersiveChrome?: boolean;
  flashtalkRecording?: boolean;
  flashtalkRecordPhase?: FlashtalkRecordPhase;
  flashtalkRecordBusy?: boolean;
  recordingSaving?: boolean;
  runtimeConfigReady?: boolean;
  runtimeConfigLoading?: boolean;
  sessionEnding?: boolean;
  onEndSession?: () => void;
  onConversationViewModeChange?: (mode: ConversationViewMode) => void;
  onFlashtalkRecordStart?: () => void;
  onFlashtalkRecordStop?: () => void;
  onFlashtalkRecordSave?: () => void;
  onWorkflowChange?: (workflow: StudioWorkflow) => void;
}

export function TopBar({
  membershipLabel,
  onMembership,
  accountLabel,
  accountAvatar,
  onAccount,
  canManageSettings = true,
  onLogout,
  connection,
  workflow = "realtime",
  conversationViewMode = "studio",
  immersiveChrome = false,
  flashtalkRecording = false,
  flashtalkRecordPhase = "idle",
  flashtalkRecordBusy = false,
  recordingSaving = false,
  runtimeConfigReady = false,
  runtimeConfigLoading = false,
  sessionEnding = false,
  onEndSession,
  onConversationViewModeChange,
  onFlashtalkRecordStart,
  onFlashtalkRecordStop,
  onFlashtalkRecordSave,
  onWorkflowChange,
}: TopBarProps) {
  const busy = flashtalkRecordBusy || recordingSaving;

  return (
    <header
      className={
        immersiveChrome
          ? "group fixed inset-x-0 top-0 z-50 flex h-14 -translate-y-12 items-center justify-between border-b border-white/10 bg-white/92 px-4 shadow-lg shadow-slate-950/10 backdrop-blur transition-transform duration-200 hover:translate-y-0"
          : "flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm"
      }
    >
      {immersiveChrome ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[-0.65rem] flex justify-center opacity-100 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0">
          <div className="h-1.5 w-16 rounded-full bg-white/80 shadow-sm" />
        </div>
      ) : null}
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-cyan-300">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M12 2l1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7L12 2Zm6 12 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">
            <span className="sm:hidden">OpenTalking</span>
            <span className="hidden sm:inline">OpenTalking Studio</span>
          </p>
          <p className="hidden truncate text-xs text-slate-500 sm:block">实时数字人工作台</p>
        </div>
      </div>

      <nav
        className={
          immersiveChrome
            ? "hidden"
            : "hidden items-center gap-1 rounded-lg bg-slate-100 p-1 md:flex"
        }
        aria-label="工作台模块"
      >
        {[
          ["realtime", "实时对话"],
          ["videoCreation", "视频创作"],
          ["assetLibrary", "作品库"],
          ["knowledge", "知识与记忆"],
        ].map(([id, label]) => {
          const active = workflow === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onWorkflowChange?.(id as StudioWorkflow)}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "bg-white text-cyan-700 shadow-sm"
                  : "text-slate-500 hover:bg-white/70 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
        {!immersiveChrome ? (
          <select
            value={workflow === "runtimeConfig" ? "" : workflow}
            onChange={(event) => onWorkflowChange?.(event.target.value as StudioWorkflow)}
            className="max-w-28 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 md:hidden"
            aria-label="切换工作台模块"
          >
            <option value="" disabled>选择模块</option>
            <option value="realtime">实时对话</option>
            <option value="videoCreation">视频创作</option>
            <option value="assetLibrary">作品库</option>
            <option value="knowledge">知识与记忆</option>
          </select>
        ) : null}
        {workflow === "realtime" ? (
          <div className="hidden rounded-lg bg-slate-100 p-1 sm:flex" aria-label="实时对话视图">
            {[
              ["studio", "工作台"],
              ["immersive", "沉浸"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={(event) => {
                  event.currentTarget.blur();
                  onConversationViewModeChange?.(id as ConversationViewMode);
                }}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                  conversationViewMode === id
                    ? "bg-white text-cyan-700 shadow-sm"
                    : "text-slate-500 hover:bg-white/70 hover:text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {flashtalkRecording ? (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {flashtalkRecordPhase === "idle" ? (
              <button
                type="button"
                disabled={busy}
                onClick={onFlashtalkRecordStart}
                className="rounded-lg bg-cyan-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-45 sm:px-3 sm:text-xs"
                title="从此时起录制浏览器中的数字人画面、用户麦克风和可用的远端音轨"
              >
                {busy ? "请稍候..." : "开始录制"}
              </button>
            ) : null}
            {flashtalkRecordPhase === "recording" ? (
              <>
                <span className="hidden rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 sm:inline">
                  录制中
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onFlashtalkRecordStop}
                  className="rounded-lg bg-red-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-45 sm:px-3 sm:text-xs"
                  title="停止浏览器录制；停止后会自动保存到作品库"
                >
                  {busy ? "请稍候..." : "结束录制"}
                </button>
              </>
            ) : null}
            {flashtalkRecordPhase === "stopped" ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onFlashtalkRecordSave}
                  className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45 sm:px-3 sm:text-xs"
                  title="重试保存上一次未上传成功的浏览器录制"
                >
                  {recordingSaving ? "导出中..." : "重试保存"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onFlashtalkRecordStart}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 sm:px-3 sm:text-xs"
                  title="开始新一轮浏览器录制"
                >
                  重新录制
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {(connection === "live" || connection === "expiring" || sessionEnding) && onEndSession ? (
          <button
            type="button"
            disabled={sessionEnding || flashtalkRecordBusy}
            onClick={onEndSession}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sessionEnding ? "结束中…" : "结束对话"}
          </button>
        ) : null}
        {canManageSettings && <button
          type="button"
          onClick={() => onWorkflowChange?.("runtimeConfig")}
          aria-label="打开 API 配置设置"
          aria-current={workflow === "runtimeConfig" ? "page" : undefined}
          className={`h-8 rounded-lg border px-3 text-xs font-semibold transition ${
            workflow === "runtimeConfig"
              ? "border-cyan-200 bg-cyan-50 text-cyan-700 shadow-sm"
              : runtimeConfigReady
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
          }`}
          title={runtimeConfigLoading ? "API 配置读取中" : runtimeConfigReady ? "API 配置已配置" : "API 配置未配置"}
        >
          设置
        </button>}
        {onMembership && <button type="button" onClick={onMembership} className="rounded-lg border border-cyan-200 bg-cyan-50 px-2 py-1.5 text-xs font-semibold text-cyan-800">{membershipLabel || '会员与额度'}</button>}
        {onAccount ? <button type="button" onClick={onAccount} aria-label="打开个人中心" title="个人中心" className="flex max-w-40 items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-2.5 text-xs text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50"><span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cyan-100 font-semibold text-cyan-800">{accountAvatar ? <img src={accountAvatar} alt="账户头像" className="h-full w-full object-cover" /> : (accountLabel || '我').slice(0, 1)}</span><span className="hidden truncate sm:inline">{accountLabel || '个人中心'}</span></button> : accountLabel && <span className="hidden text-xs text-slate-500 xl:inline">{accountLabel}</span>}
        {onLogout && <button type="button" onClick={onLogout} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50">退出登录</button>}
        <div
          className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium sm:px-2.5 ${PILL_COLORS[connection]}`}
          title={DOT_LABELS[connection]}
        >
          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT_COLORS[connection]}`} />
          <span>{DOT_LABELS[connection]}</span>
        </div>
      </div>
    </header>
  );
}
