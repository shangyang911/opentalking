# Local digital-human demo

This branch provides **Realtime conversation**, **Video creation**, **Works**, and [Knowledge and memory](knowledge-memory.md).

## Realtime conversation

Choose an avatar and voice, then start a session. The retained pipeline supports text, microphone input, uploaded audio, streamed replies, subtitles, WebRTC playback, interruption, and browser recording.

- Driver: local QuickTalk; DOGO browser animation is the lightweight fallback.
- LLM: the configured remote OpenAI-compatible API.
- Speech recognition: DashScope.
- Speech synthesis: Edge, DashScope Qwen, or a personal Qwen-Audio voice.

Preparing a new avatar can take time. End the realtime session before generating a QuickTalk video to avoid concurrent GPU use.

While connected, use **End conversation** in the top bar to disconnect, stop microphone capture and playback, and return to the start screen. Chat history is preserved. Active recordings stop and are saved to Works.

DOGO recordings preserve the browser animation. Wait for the animation to be ready before recording.

## Personal voice

In the realtime sidebar, open **Speech synthesis → Personal voice → Clone voice**. Give the voice a name and upload a clear recording, preferably 10–20 seconds of one person reading without background music. WAV, MP3, M4A, WebM, OGG and MP4 are supported, up to 10 MB and 5–60 seconds.

Save a Beijing-region DashScope speech API key in Settings first. The app prioritizes `qwen-audio-3.1-tts-flash`, which offers a 1 million Token trial; check the account for remaining quota and expiry. It saves and selects each new voice automatically. You can preview, select or delete saved voices. The selection applies to realtime conversation and video narration and survives refresh. End the active conversation before changing voices.

Voice enrollment is free; previews and synthesis consume the account's speech quota. Check the Bailian console for trial availability and expiry. Recordings are temporarily converted and sent directly to Bailian without publishing a download URL. Local SQLite stores the voice name, ID and bound model. Deletion removes both the cloud voice and its local record.

## Video creation and works

Upload audio or enter narration text to generate a short video. Jobs support progress polling, cancellation, preview, and download; successful exports appear in Works. Finish or stop generation before changing workflows.

Works provides previews, filters, pagination, downloads, and confirmed deletion. Existing historical exports are preserved.

## Run

With dependencies and QuickTalk assets already installed:

```bash
bash scripts/start_unified.sh --backend local --model quicktalk --api-port 8210 --web-port 5173
```

Open <http://localhost:5173>. Settings contains only the LLM, DashScope speech recognition, and Edge/Qwen speech synthesis configuration. Edge needs no API key. Remote services require network access and appropriate credentials.

On the current machine the runtime checkout is inside WSL under `opentalking-workspace/opentalking`. Sync Windows source changes there, rebuild the frontend, and restart the backend.

After the directory migration, the workstation lives in `frontend/`, Python apps,
engine and configuration in `backend/`, and deployment resources in `deploy/`.
Install from the root with `pip install -e './backend[dev]'` and run `npm ci` from
`frontend/`. You can also start this checkout directly after installing its
dependencies, without replacing the existing WSL runtime checkout. See
[project layout and development](../docs/project-layout.md).

## Removed scope

Video cloning, streaming, knowledge bases, long-term memory, WeChat imports, persona packages, and placeholder UI modules are removed from the application and its API. Only QuickTalk and mock drivers are registered.

Avatar assets, weights, credentials, and existing works are preserved. Shared session/media/rendering/job internals remain; some internal filenames retain historical model names. Other model deployment documents describe upstream implementation history, not features offered by this demo.
