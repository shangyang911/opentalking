"""Repository paths shared by API, workers and command-line entry points."""

from __future__ import annotations

import os
from pathlib import Path


def backend_root() -> Path:
    return Path(__file__).resolve().parents[2]


def project_root() -> Path:
    explicit = os.environ.get("OPENTALKING_PROJECT_ROOT")
    if explicit:
        return Path(explicit).expanduser().resolve()
    source_root = backend_root()
    if source_root.name == "backend" and (source_root / "pyproject.toml").is_file():
        return source_root.parent
    return Path.cwd().resolve()


def project_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else (project_root() / path).resolve()


def env_file() -> Path:
    explicit = os.environ.get("OPENTALKING_ENV_FILE")
    return Path(explicit).expanduser() if explicit else project_root() / ".env"


def default_config_file() -> Path:
    return config_root() / "default.yaml"


def config_root() -> Path:
    root = backend_root()
    if root.name == "backend" and (root / "pyproject.toml").is_file():
        return root / "configs"
    return Path(__file__).resolve().parents[1] / "configs"
