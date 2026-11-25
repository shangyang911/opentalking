# TTS and personal voices

The local demo provides Edge and DashScope Qwen previews and Bailian personal voices. Run these examples from the repository root. The demo API defaults to `http://localhost:8210`.

## `POST /tts/preview`

JSON fields: `text` (required, 1–1000 characters), `voice`, `tts_provider`, and `tts_model`. Returns `audio/wav`. For a cloned voice, always pass its saved provider, model and voice ID together; the synthesis model must match the model used during enrollment.

```bash
curl -X POST http://localhost:8210/tts/preview \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello, it is good to see you.","tts_provider":"cosyvoice","tts_model":"qwen-audio-3.1-tts-flash","voice":"YOUR_VOICE_ID"}' \
  -o preview.wav
```

## `GET /voices`

Returns `{"voices": [...]}` containing the single-user demo's saved Bailian clones. Entries include `id`, `user_id`, `provider`, `voice_id`, `display_label`, `target_model`, and `source`. System voices are excluded. Voice metadata persists in SQLite at `OPENTALKING_SQLITE_PATH`, defaulting to `./data/opentalking.sqlite3`.

## `POST /voices/clone`

Multipart fields: `audio` (recording) and `display_label` (name, 1–40 characters). The target model is fixed to `qwen-audio-3.1-tts-flash`; no provider or model field is needed.

Supported formats: WAV, MP3, M4A, WebM, OGG, MP4. Maximum size: 10 MB. Duration: 5–60 seconds, preferably 10–20 seconds of one clear speaker. FFmpeg converts the audio to 24 kHz mono WAV and sends it directly to Bailian as Base64. The app waits for readiness before saving. Temporary audio files are removed after conversion; no public `/voice-uploads` endpoint is exposed.

```bash
curl -X POST http://localhost:8210/voices/clone \
  -F 'display_label=Familiar voice' \
  -F 'audio=@sample.wav'
```

Returns `201` with the voice entry. Errors: `400` missing key or invalid audio; `413` oversized file; `422` missing fields or invalid name length; `502` upstream failure; `504` upstream timeout. Uses `OPENTALKING_TTS_DASHSCOPE_API_KEY` saved in runtime settings, with Beijing-region model access.

## `DELETE /voices/{entry_id}`

Deletes the cloud voice and local entry. Returns `204` with no body, `404` for a missing or non-clone entry, or `502` when cloud deletion fails. The local entry is retained on upstream failure so the operation can be retried. System voices cannot be deleted.

Enrollment is free. Previews and synthesis consume Bailian quota and follow account billing rules; indefinite free use is not guaranteed. See [voice cloning](https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide) and [pricing](https://help.aliyun.com/zh/model-studio/model-pricing).
