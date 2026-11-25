# OpenTalking backend

Python API, unified server, worker, CLI, engine, configuration, and tests live here.

From the repository root:

```bash
pip install -e './backend[dev]'
opentalking-unified
pytest backend/tests
```

The Python package names (`opentalking`, `apps`) and `opentalking-*` CLI commands remain stable.
The shared `.env`, `examples/avatars`, `data/` and `output/` live at the repository root.
Default configuration is `backend/configs/default.yaml`; explicit environment overrides still apply.

API business modules are in `backend/apps/api/modules/`: conversation, avatars, voices,
video_creation, works, and system. The engine stays organized by runtime, pipeline,
providers, models, avatar, and voice under `opentalking/`.

See the root README and `docs/zh/usage/local-demo.md` for the current demo scope and startup commands.
