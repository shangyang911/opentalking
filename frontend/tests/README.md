# Frontend checks

Run from `frontend/`:

```bash
npm test
npm run typecheck
npm run build
```

The Node tests exercise browser audio math, avatar/model selection, voice bindings,
workflow controls and configuration rendering. Python checks for the current
workstation live in `regression/` and run from the repository root:

```bash
pytest frontend/tests/regression
```

`upstream/` preserves historical source assertions for knowledge, memory, scene
management, dual-person/reference-video creation and the former configuration UI.
Those capabilities or UI implementations were already removed in this local demo
before the directory migration. The full old frontend suite had 40 failures before
migration (41 in the initial text-only snapshot, including one absent image).
These tests remain available explicitly with `pytest frontend/tests/upstream`, but
are outside the current demo's default regression scope. Current configuration UI
behavior is covered by `runtimeConfig.test.ts` instead of obsolete source strings.
