import json

import pytest
from fastapi import HTTPException

from opentalking.core.identity import Identity, avatar_accessible, current_identity
from opentalking.voice import store


def test_accounts_only_list_and_delete_their_own_cloned_voices(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENTALKING_SQLITE_PATH", str(tmp_path / "voices.db"))
    store.init_voice_store()
    token = current_identity.set(Identity(2, "user"))
    try:
        entry = store.insert_clone(provider="cosyvoice", voice_id="alice-voice", display_label="Alice", target_model="qwen-audio")
    finally:
        current_identity.reset(token)
    token = current_identity.set(Identity(3, "user"))
    try:
        assert all(voice.source == "system" for voice in store.list_voices())
        assert store.get_entry(entry) is None
        assert not store.delete_entry(entry)
    finally:
        current_identity.reset(token)
    assert store.get_entry(entry, user_id=2)["voice_id"] == "alice-voice"


def test_cannot_synthesize_a_different_accounts_voice(tmp_path, monkeypatch):
    from apps.api.core.asset_access import require_voice_access
    monkeypatch.setenv("OPENTALKING_SQLITE_PATH", str(tmp_path / "voices.db"))
    store.init_voice_store()
    store.insert_clone(user_id=2, provider="cosyvoice", voice_id="alice-voice", display_label="Alice", target_model="qwen-audio")
    token = current_identity.set(Identity(3, "user"))
    try:
        with pytest.raises(HTTPException) as error:
            require_voice_access("alice-voice")
        assert error.value.status_code == 404
        with pytest.raises(HTTPException):
            require_voice_access("  alice-voice  ")
        require_voice_access("Cherry")
    finally:
        current_identity.reset(token)


def test_system_avatars_are_readable_but_only_owned_custom_avatars_are_mutable(tmp_path):
    token = current_identity.set(Identity(2, "user"))
    try:
        for metadata, readable, mutable in [({}, True, False), ({"custom_avatar": True}, False, False),
                                           ({"custom_avatar": True, "owner_id": 3}, False, False),
                                           ({"custom_avatar": True, "owner_id": 2}, True, True)]:
            (tmp_path / "manifest.json").write_text(json.dumps({"metadata": metadata}))
            assert avatar_accessible(tmp_path) == readable
            assert avatar_accessible(tmp_path, modify=True) == mutable
    finally:
        current_identity.reset(token)


def test_user_reference_customization_does_not_modify_shared_avatar(tmp_path):
    from types import SimpleNamespace
    from apps.api.modules.conversation.sessions import _save_custom_reference
    avatar = tmp_path / "avatars" / "system"
    avatar.mkdir(parents=True)
    original = '{"metadata": {"mouth": "original"}}'
    (avatar / "manifest.json").write_text(original)
    token = current_identity.set(Identity(2, "user"))
    try:
        target = _save_custom_reference(SimpleNamespace(exports_dir=str(tmp_path / "exports")), avatar, b"private-image", ".png")
        assert target.read_bytes() == b"private-image"
        assert not target.is_relative_to(avatar)
        assert (avatar / "manifest.json").read_text() == original
        assert list(avatar.iterdir()) == [avatar / "manifest.json"]
    finally:
        current_identity.reset(token)
