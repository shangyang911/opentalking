"""Exercise release promotion and recovery without contacting a real server."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "deploy_ecs.sh"
SHA = "a" * 40
API = "ghcr.io/shangyang911/opentalking-api@sha256:" + "b" * 64
WEB = "ghcr.io/shangyang911/opentalking-web@sha256:" + "c" * 64


@pytest.fixture
def deployment(tmp_path):
    if os.name == "nt":
        pytest.skip("Deployment runs on Linux")
    root = tmp_path / "server"
    shared = root / "shared" / "runtime"
    shared.mkdir(parents=True)
    (shared / "app.env").write_text("OPENTALKING_AUTH_ENABLED=true\n")
    (root / "shared" / "stack.env").write_text("MYSQL_PASSWORD=fixture\n")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(f"#!{sys.executable}\n" + '''import json, os, sys
with open(os.environ['CALL_LOG'], 'a') as f:
    f.write(json.dumps(sys.argv[1:]) + '\\n')
if 'up' in sys.argv and os.environ.get('FAIL_NEW') == '1':
    if not any('previous' in arg for arg in sys.argv):
        sys.exit(1)
''')
    curl = bin_dir / "curl"
    curl.write_text(f"#!{sys.executable}\n" + '''import json, os, pathlib, sys
if '-o' in sys.argv:
    pathlib.Path(sys.argv[sys.argv.index('-o') + 1]).write_text('services: {}\\n')
elif any('/compare/' in arg for arg in sys.argv):
    stale = os.environ.get('STALE_RELEASE') == '1' and not any(arg.endswith('...main') for arg in sys.argv)
    print(json.dumps({'status': 'behind' if stale else 'ahead'}))
''')
    docker.chmod(0o755)
    curl.chmod(0o755)
    env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ["PATH"],
               OPENTALKING_DEPLOY_ROOT=str(root), CALL_LOG=str(tmp_path / "calls.jsonl"))
    return root, env


def run_deploy(env, sha=SHA, api=API):
    return subprocess.run(["bash", str(SCRIPT), sha, api, WEB], env=env,
                          input="fixture-registry-token\n", text=True, capture_output=True)


def test_healthy_release_is_promoted_and_credentials_are_removed(deployment):
    root, env = deployment
    result = run_deploy(env)
    assert result.returncode == 0, result.stderr
    current = (root / "current").resolve()
    assert current.parent == root / "releases"
    assert API in (current / "images.env").read_text()
    assert not list(root.glob(".docker.*"))
    assert "fixture-registry-token" not in result.stdout + result.stderr


def test_failed_release_restores_previous_and_does_not_promote(deployment):
    root, env = deployment
    previous = root / "releases" / "previous"
    previous.mkdir(parents=True)
    (previous / "compose.yml").write_text("services: {}\n")
    (previous / "images.env").write_text("API_IMAGE=previous\nRELEASE_SHA=" + "d" * 40 + "\n")
    (root / "current").symlink_to(previous)
    result = run_deploy(dict(env, FAIL_NEW="1"))
    assert result.returncode != 0
    assert (root / "current").resolve() == previous
    calls = [json.loads(line) for line in Path(env["CALL_LOG"]).read_text().splitlines()]
    assert any("up" in call and str(previous / "compose.yml") in call for call in calls)
    assert not list(root.glob(".docker.*"))


def test_older_workflow_cannot_replace_a_newer_release(deployment):
    root, env = deployment
    current = root / "releases" / "previous"
    current.mkdir(parents=True)
    (current / "compose.yml").write_text("services: {}\n")
    (current / "images.env").write_text("RELEASE_SHA=" + "d" * 40 + "\n")
    (root / "current").symlink_to(current)
    result = run_deploy(dict(env, STALE_RELEASE="1"))
    assert result.returncode != 0
    assert "older" in result.stderr.lower()
    assert (root / "current").resolve() == current
    assert not Path(env["CALL_LOG"]).exists()


@pytest.mark.parametrize("sha,api", [("main; touch /tmp/injected", API), (SHA, "untrusted/image:latest")])
def test_invalid_release_input_never_reaches_docker(deployment, sha, api):
    root, env = deployment
    result = run_deploy(env, sha, api)
    assert result.returncode != 0
    assert "Invalid" in result.stderr
    assert not (root / "current").exists()
    assert not Path(env["CALL_LOG"]).exists()


def test_missing_runtime_configuration_stops_before_deployment(deployment):
    root, env = deployment
    (root / "shared" / "runtime" / "app.env").unlink()
    result = run_deploy(env)
    assert result.returncode != 0
    assert "Missing server configuration" in result.stderr
    assert not Path(env["CALL_LOG"]).exists()
