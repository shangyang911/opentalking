export type SceneBackgroundAsset = {
  id: string;
  name: string;
  kind: "image" | "video";
  mime_type: string;
  filename: string;
  size_bytes: number;
  url: string;
  created_at: string;
};

export type SceneComposition = {
  id: string;
  name: string;
  avatar_id: string;
  background_id: string | null;
  background_color: string;
  avatar_fit: "contain" | "cover";
  avatar_scale: number;
  avatar_anchor: "center" | "bottom" | "left" | "right";
  matting_required: boolean;
  subtitle_style: "none" | "compact" | "lower-third";
  created_at: string;
  updated_at: string;
};

export type PersonMode = "single" | "double";

export type DuoDialogCapability = {
  speaker_faces: Record<string, string>;
  default_voices: Record<string, string>;
};

export type ClientRendererDescriptor = {
  type: "light2d";
  config_url: string;
  asset_base_url: string;
  recommended_for: string[];
};

export type AvatarSummary = {
  id: string;
  name: string | null;
  model_type: string;
  width: number;
  height: number;
  person_mode: PersonMode;
  is_custom: boolean;
  has_preview_video: boolean;
  matting_status: "unknown" | "opaque" | "transparent_ready";
  duo_dialog: DuoDialogCapability | null;
  client_renderer: ClientRendererDescriptor | null;
};
