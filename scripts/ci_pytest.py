"""Run current regressions while retaining explicit, strict upstream failures."""
from __future__ import annotations

import json
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]


class UpstreamBaseline:
    def __init__(self) -> None:
        baseline = json.loads((ROOT / ".github/ci-known-failures.json").read_text())
        self.nodeids = set(baseline["nodeids"])
        self.reason = baseline["reason"]

    def pytest_collection_modifyitems(self, items) -> None:
        for item in items:
            if item.nodeid in self.nodeids:
                item.add_marker(pytest.mark.xfail(reason=self.reason, strict=True))


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    arguments = sys.argv[1:] or ["backend/tests", "frontend/tests/regression"]
    raise SystemExit(pytest.main(["-c", str(ROOT / "pytest.ini"), *arguments], plugins=[UpstreamBaseline()]))
