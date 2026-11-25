"""Request identity, also propagated into async jobs and asyncio.to_thread."""
from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
import json


@dataclass(frozen=True)
class Identity:
    id: int
    role: str
    phone: str | None = None
    username: str | None = None


current_identity: ContextVar[Identity | None] = ContextVar("opentalking_identity", default=None)


def owner_id() -> int:
    identity = current_identity.get()
    return identity.id if identity else 1


def private_root(root: Path | str) -> Path:
    base = Path(root).expanduser().resolve()
    identity = current_identity.get()
    # Legacy local data remains available to the pre-provisioned administrator.
    return base / "accounts" / str(identity.id) if identity and identity.role == "user" else base


def avatar_accessible(directory: Path, *, modify: bool = False) -> bool:
    identity = current_identity.get()
    if not identity or identity.role == "admin":
        return True
    try:
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    metadata = manifest.get("metadata") or {}
    custom = bool(metadata.get("custom_avatar"))
    owner = metadata.get("owner_id")
    if owner is not None:
        return str(owner) == str(identity.id)
    return not custom and not modify
