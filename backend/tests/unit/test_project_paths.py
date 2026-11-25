from pathlib import Path

from opentalking.core.paths import backend_root, default_config_file, env_file, project_path, project_root


def test_defaults_are_stable_when_working_directory_changes(tmp_path, monkeypatch):
    root = project_root()
    monkeypatch.delenv("OPENTALKING_ENV_FILE", raising=False)
    monkeypatch.chdir(tmp_path)
    assert env_file() == root / ".env"
    assert default_config_file() == backend_root() / "configs/default.yaml"
    assert project_path("./examples/avatars") == root / "examples/avatars"
    assert project_path("./data/voices.sqlite3") == root / "data/voices.sqlite3"


def test_explicit_environment_file_is_respected(tmp_path, monkeypatch):
    explicit = tmp_path / "custom.env"
    monkeypatch.setenv("OPENTALKING_ENV_FILE", str(explicit))
    assert env_file() == explicit


def test_absolute_resource_paths_are_preserved(tmp_path):
    absolute = tmp_path / "external-assets"
    assert project_path(absolute) == absolute
    assert isinstance(project_root(), Path)


def test_settings_reads_an_explicit_env_file_after_import(tmp_path, monkeypatch):
    from opentalking.core.config import Settings

    explicit = tmp_path / "settings.env"
    database = tmp_path / "isolated.sqlite3"
    explicit.write_text(f"OPENTALKING_SQLITE_PATH={database}\n", encoding="utf-8")
    monkeypatch.setenv("OPENTALKING_ENV_FILE", str(explicit))
    assert Path(Settings().sqlite_path) == database


def test_installed_package_resolves_runtime_root_from_working_directory(tmp_path, monkeypatch):
    from opentalking.core import paths

    monkeypatch.setattr(paths, "backend_root", lambda: tmp_path / "site-packages")
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    monkeypatch.chdir(runtime)
    assert paths.project_root() == runtime


def test_explicit_project_root_overrides_runtime_location(tmp_path, monkeypatch):
    from opentalking.core import paths

    monkeypatch.setenv("OPENTALKING_PROJECT_ROOT", str(tmp_path))
    assert paths.project_root() == tmp_path
