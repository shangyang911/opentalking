# Project layout and development

This guide is for developers maintaining the current local demo. The repository
keeps frontend and backend together, with separate dependency and build entry points.

The root `总纲.md` is the main entry for the current scope and maintenance rules.

## Directory ownership

- `frontend/src/app/`: workstation composition, navigation, shared session and media lifecycle.
- `frontend/src/features/`: `conversation`, `avatars` (including light2d), `voices`, `video-creation`, `works`, and `settings`.
- `frontend/src/shared/`: HTTP transport, common types, UI and styles; no dependency on feature modules.
- `frontend/homepage/`: the independent product homepage with its own dependencies, server and build.
- `backend/apps/api/modules/`: routes, schemas and services grouped into `conversation`, `avatars`, `voices`, `video_creation`, `works`, and `system`.
- `backend/apps/api/core/router.py`: business route registration shared by API and unified servers.
- `backend/apps/unified/`, `backend/apps/cli/`: runtime and command-line entry points.
- `backend/opentalking/`: configuration, avatar/voice domains, providers, model adapters, pipelines and workers. The Python package remains `opentalking`.
- `backend/configs/`, `backend/tests/`: backend configuration, API/unit tests and shared fixtures.
- `deploy/`, `scripts/`, `docs/`: deployment resources, project scripts and bilingual documentation.

Feature API requests and types live in each feature's `api.ts`; common HTTP
transport lives in `frontend/src/shared/api/client.ts`. The app still coordinates
cross-workflow state and preserves browser recording, WebRTC, microphone and subtitles.

## Install and start

From the repository root on Linux, macOS or WSL:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e './backend[dev]'
cd frontend
npm ci
cd ..
bash scripts/start_unified.sh --mock
```

Keep an existing `.env`; copy `.env.example` only for a first installation.
The browser defaults to `http://localhost:5173`, with the backend on port `8000`.

When the frontend development server runs under WSL from `/mnt/<drive>/`, Vite polls files every 500 milliseconds so edits made by Windows editors trigger hot reload. Production previews still require a rebuild. After changing a locally running feature, check the actual page version and restart with the existing ports and configuration when necessary, then verify the result.

The real local QuickTalk path is unchanged:

```bash
bash scripts/start_unified.sh --backend local --model quicktalk --api-port 8210 --web-port 5173
```

You can also install and start the backend from its own directory:

```bash
cd backend
pip install -e '.[dev]'
opentalking-unified
```

## Configuration and data

`.env`, `examples/avatars/`, `data/` and `output/` stay at the repository root.
Default YAML configuration is `backend/configs/default.yaml`. The shared path
helpers in `backend/opentalking/core/paths.py` resolve the same configuration and
resources when starting from either the root or backend directory.

Explicit `OPENTALKING_ENV_FILE`, `OPENTALKING_CONFIG_FILE`, model and resource
overrides remain supported. Local relative resource paths resolve against the
repository root; absolute paths are preserved. API URLs, static asset URLs and
browser localStorage keys remain unchanged.

## Validation

From the repository root:

```bash
pytest backend/tests frontend/tests/regression frontend/homepage/tests
ruff check --config backend/pyproject.toml backend/opentalking/core backend/opentalking/events backend/opentalking/avatar backend/apps backend/tests
python scripts/docs/check_i18n_structure.py
python scripts/docs/check_api_docs.py
cd frontend
npm test
npm run typecheck
npm run build
cd homepage
npm run build
```

Historical upstream UI assertions remain in `frontend/tests/upstream/`. They
describe knowledge, memory, scene management and other capabilities or old UI
already removed from this local demo before the migration, and are outside the
current demo's default regression scope. See `frontend/tests/README.md`.

See `deploy/README.md` in the repository for deployment. Run
`bash scripts/compose.sh up --build` from the root.
