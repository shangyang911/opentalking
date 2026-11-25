from __future__ import annotations

import sys
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"

for path in (ROOT, BACKEND):
    path_str = str(path)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)


@pytest.fixture(autouse=True)
def isolate_test_environment_file(monkeypatch, tmp_path):
    """Tests must opt in to fixtures rather than load real provider credentials."""
    original_environment = dict(os.environ)
    monkeypatch.setenv("OPENTALKING_ENV_FILE", str(tmp_path / ".env"))
    # Existing engine tests exercise the standalone local profile. Auth tests
    # install their own enabled middleware with an isolated account database.
    monkeypatch.setenv("OPENTALKING_AUTH_ENABLED", "false")
    from opentalking.core.config import get_settings

    get_settings.cache_clear()
    yield
    os.environ.clear()
    os.environ.update(original_environment)
    get_settings.cache_clear()
