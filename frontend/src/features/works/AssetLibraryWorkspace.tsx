import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiDelete, apiGet, buildApiDownloadUrl } from "../../shared/api/client";
import { type ExportVideoItem } from "./api";

type AssetLibraryWorkspaceProps = {
  refreshToken?: number;
  onNotify?: (message: string, tone?: "info" | "success" | "error") => void;
};

type WorkFilter = "all" | "realtime_dialogue" | "video_creation";

const KIND_LABELS: Record<ExportVideoItem["kind"], string> = {
  realtime_dialogue: "实时对话",
  video_creation: "视频创作",
  video_clone: "历史作品",
};

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "时长未知";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

const PAGE_SIZE = 50;

export function AssetLibraryWorkspace({ refreshToken = 0, onNotify }: AssetLibraryWorkspaceProps) {
  const [items, setItems] = useState<ExportVideoItem[]>([]);
  const [filter, setFilter] = useState<WorkFilter>("all");
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const loadWorks = useCallback(async (offset = 0) => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (filter !== "all") query.set("kind", filter);
    try {
      const result = await apiGet<{ items: ExportVideoItem[] }>(`/exports/videos?${query}`);
      if (currentRequest !== requestId.current) return;
      setItems((current) => offset === 0 ? result.items : [...current, ...result.items]);
      setHasMore(result.items.length === PAGE_SIZE);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      setError(err instanceof ApiError && err.detail ? err.detail : "作品加载失败，请稍后重试。");
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setItems([]);
    setHasMore(false);
    void loadWorks();
    return () => { requestId.current += 1; };
  }, [loadWorks, refreshToken]);

  const handleDelete = async (item: ExportVideoItem) => {
    if (!window.confirm(`删除作品「${item.title}」？删除后无法恢复，请先下载需要保留的视频。`)) return;
    setDeletingId(item.id);
    setError(null);
    try {
      await apiDelete(`/exports/videos/${encodeURIComponent(item.id)}`);
      onNotify?.("作品已删除。", "success");
      await loadWorks();
    } catch (err) {
      const message = err instanceof ApiError && err.detail ? `删除失败：${err.detail}` : "删除失败，请稍后重试。";
      setError(message);
      onNotify?.(message, "error");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50 p-3 sm:p-5">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="作品库">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-950">作品库</h1>
            <p className="mt-1 text-xs text-slate-500">查看、下载和管理实时对话录制与创作视频。</p>
          </div>
          <button
            type="button"
            disabled={loading || deletingId !== null}
            onClick={() => void loadWorks()}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-cyan-200 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "加载中..." : "刷新"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-slate-200 px-4 py-3" role="group" aria-label="作品来源">
          {([
            ["all", "全部作品"],
            ["realtime_dialogue", "实时对话"],
            ["video_creation", "视频创作"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              disabled={deletingId !== null}
              onClick={() => setFilter(value)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                filter === value
                  ? "border-cyan-200 bg-cyan-50 text-cyan-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-busy={loading}>
          {error ? <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
          {loading && !items.length ? <p role="status" className="py-16 text-center text-sm text-slate-500">正在加载作品...</p> : null}
          {!loading && !error && !items.length ? (
            <div className="flex min-h-[18rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <p className="text-sm font-semibold text-slate-700">{filter === "all" ? "还没有作品" : "暂无此类作品"}</p>
              <p className="text-xs text-slate-500">录制实时对话或完成视频创作后，保存的视频会显示在这里。</p>
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <article key={item.id} className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <video
                  className="aspect-video w-full bg-slate-950 object-contain"
                  src={buildApiDownloadUrl(item.download_url)}
                  aria-label={`预览 ${item.title}`}
                  controls
                  playsInline
                  preload="metadata"
                />
                <div className="space-y-3 p-3">
                  <div>
                    <h2 className="truncate text-sm font-semibold text-slate-950" title={item.title}>{item.title}</h2>
                    <p className="mt-1 text-xs text-slate-500">{KIND_LABELS[item.kind]} · {formatDuration(item.duration_sec)} · {formatSize(item.size_bytes)}</p>
                    <p className="mt-1 text-xs text-slate-400">{formatCreatedAt(item.created_at)}</p>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={buildApiDownloadUrl(item.download_url)}
                      download
                      className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500"
                    >
                      下载
                    </a>
                    <button
                      type="button"
                      disabled={deletingId !== null || loading}
                      onClick={() => void handleDelete(item)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingId === item.id ? "删除中..." : "删除"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {hasMore ? (
            <div className="mt-4 text-center">
              <button
                type="button"
                disabled={loading || deletingId !== null}
                onClick={() => void loadWorks(items.length)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "加载中..." : "加载更多"}
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
