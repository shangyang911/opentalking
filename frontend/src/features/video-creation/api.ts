import { apiGet, apiPostForm, apiPostWithHeaders } from "../../shared/api/client";
import type { ExportVideoItem } from "../works/api";

export type VideoCreationAudioSource = "upload" | "tts_text";

export type VideoCreationJobResponse = {
  job_id: string;
  status: "queued" | "generating" | "finalizing" | "completed" | "done" | "error" | "failed" | string;
  source?: VideoCreationAudioSource | string;
  export_video?: ExportVideoItem;
  generated_duration_ms?: number;
  published_duration_ms?: number;
  buffer_duration_ms?: number;
  first_media_at?: number | null;
  first_sequence?: number | null;
  first_pts_ms?: number | null;
  finalized_at?: number | null;
  final_export_id?: string | null;
  error_code?: string | null;
};

export type CreateVideoCreationJobInput = {
  model: string;
  avatarId: string;
  title?: string;
  audioSource: VideoCreationAudioSource;
  audioFile?: File | null;
  text?: string;
  ttsProvider?: string;
  ttsModel?: string;
  voice?: string;
  executionMode?: "sync" | "async";
};

export async function createVideoCreationJob(input: CreateVideoCreationJobInput): Promise<VideoCreationJobResponse> {
  const form = new FormData();
  form.set("model", input.model);
  form.set("avatar_id", input.avatarId);
  form.set("audio_source", input.audioSource);
  form.set("execution_mode", input.executionMode ?? "async");
  if (input.title) form.set("title", input.title);
  if (input.audioFile) form.set("audio_file", input.audioFile);
  if (input.text) form.set("text", input.text);
  if (input.ttsProvider) form.set("tts_provider", input.ttsProvider);
  if (input.ttsModel) form.set("tts_model", input.ttsModel);
  if (input.voice) form.set("voice", input.voice);
  return apiPostForm<VideoCreationJobResponse>("/video-creation/jobs", form);
}

export async function getVideoCreationJob(jobId: string): Promise<VideoCreationJobResponse> {
  return apiGet<VideoCreationJobResponse>(`/video-creation/jobs/${encodeURIComponent(jobId)}`);
}

export async function stopVideoCreationJob(jobId: string): Promise<VideoCreationJobResponse> {
  return apiPostWithHeaders<VideoCreationJobResponse>(
    `/video-creation/jobs/${encodeURIComponent(jobId)}/stop`,
    {},
    {},
  );
}
