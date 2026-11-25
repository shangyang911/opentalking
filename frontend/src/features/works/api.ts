import { apiPostForm } from "../../shared/api/client";

export type ExportVideoKind = "realtime_dialogue" | "video_clone" | "video_creation";

export type ExportVideoItem = {
  id: string;
  kind: ExportVideoKind;
  title: string;
  duration_sec: number | null;
  size_bytes: number;
  mime_type: string;
  created_at: string;
  path: string;
  download_url: string;
  session_id: string | null;
  avatar_id: string | null;
  model: string | null;
};

export type UploadExportVideoInput = {
  blob: Blob;
  kind: ExportVideoKind;
  title: string;
  durationSec?: number | null;
  sessionId?: string | null;
  avatarId?: string | null;
  model?: string | null;
  accountId?: number;
};

export function exportVideoExtensionForMimeType(mimeType: string): ".mp4" | ".webm" {
  const normalized = mimeType.split(";", 1)[0].trim().toLowerCase();
  if (normalized === "video/mp4") return ".mp4";
  if (normalized === "video/webm") return ".webm";
  return ".webm";
}

export async function uploadExportVideo(input: UploadExportVideoInput): Promise<ExportVideoItem> {
  const form = new FormData();
  form.set("file", input.blob, `${input.kind}${exportVideoExtensionForMimeType(input.blob.type)}`);
  form.set("kind", input.kind);
  form.set("title", input.title);
  if (input.durationSec != null) form.set("duration_sec", String(input.durationSec));
  if (input.sessionId) form.set("session_id", input.sessionId);
  if (input.avatarId) form.set("avatar_id", input.avatarId);
  if (input.model) form.set("model", input.model);
  return apiPostForm<ExportVideoItem>("/exports/videos", form, input.accountId === undefined ? undefined : { headers: { "X-Opentalking-Account": String(input.accountId) } });
}
