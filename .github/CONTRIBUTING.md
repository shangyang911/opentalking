# Contributing

Start with the repository's [project overview](../总纲.md) for current scope, layout and maintenance rules.

## Development Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip setuptools wheel
pip install -e "./backend[dev]"
cd frontend && npm ci
```

Install engine extras if you are working on FlashTalk:

```bash
pip install -e "./backend[engine,demo]"
```

## Workflow

1. Create a focused branch.
2. Keep changes scoped to one problem or migration step.
3. Run the relevant checks before opening a PR.
4. Include setup notes for anything hardware-specific.

## Checks

```bash
ruff check --config backend/pyproject.toml backend/opentalking/core backend/opentalking/events backend/opentalking/avatar backend/apps backend/tests
mypy --config-file backend/pyproject.toml backend/opentalking/core backend/opentalking/events backend/opentalking/avatar backend/apps --ignore-missing-imports
pytest backend/tests frontend/tests/regression
cd frontend && npm run build
```

## Project Conventions

- Python engine code lives in `backend/opentalking/`; applications live in `backend/apps/`.
- `frontend/` is the frontend. Do not mix backend code into it.
- Prefer `opentalking.*` imports over legacy package namespaces.
- Keep environment-specific paths configurable through env vars.
- Do not commit secrets, credentials, or machine-specific paths.

## Large Changes

For architecture work, include:

- the migration scope
- compatibility impact
- operational changes
- test coverage or validation performed

## Reporting Issues

Use the GitHub issue templates for bugs and feature requests.
