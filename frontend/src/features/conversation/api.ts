export type CreateSessionRequest = {
  persona_id?: string;
  avatar_id?: string;
  model?: string;
  llm_system_prompt?: string;
  tts_provider: string;
  stt_provider: string;
  tts_voice?: string;
  tts_model?: string;
  wav2lip_postprocess_mode?: string;
  fasterliveportrait_config?: Record<string, unknown>;
  user_id: string;
  agent_enabled: boolean;
  memory_enabled: boolean;
  memory_mode?: "explicit";
  memory_profile_id?: string;
  character_id?: string;
  memory_library_id?: string;
  knowledge_enabled: boolean;
  knowledge_base_id: string;
  knowledge_base_ids: string[];
};

export type CreateSessionResponse = { session_id: string; status: string };
