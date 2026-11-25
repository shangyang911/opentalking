from __future__ import annotations

import pytest

from opentalking.agent.context_builder import AgentSessionConfig, build_agent_context, default_memory_store
from opentalking.agent.memory_store import AgentMemoryStore


@pytest.mark.asyncio
async def test_personal_memory_is_recalled_after_switching_avatar(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENTALKING_AGENT_MEMORY_SQLITE_PATH", str(tmp_path / "memory.sqlite"))
    first = default_memory_store("11")
    await first.save_memory(user_id="11", avatar_id="avatar-a", kind="explicit", content="叫我小林，我不吃香菜")
    context = await build_agent_context(config=AgentSessionConfig(user_id="11", agent_enabled=True, memory_enabled=True), avatar_id="avatar-b")
    assert context and "叫我小林，我不吃香菜" in context
    other = await build_agent_context(config=AgentSessionConfig(user_id="22", agent_enabled=True, memory_enabled=True), avatar_id="avatar-b")
    assert other is None


@pytest.mark.asyncio
async def test_existing_avatar_memories_remain_manageable_account_wide(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENTALKING_AGENT_MEMORY_SQLITE_PATH", str(tmp_path / "memory.sqlite"))
    personal = default_memory_store("11")
    legacy = AgentMemoryStore(personal.db_path)
    record = await legacy.save_memory(user_id="11", avatar_id="old-avatar", kind="explicit", content="喜欢喝热水")
    records = await personal.list_memories(user_id="11", avatar_id="new-avatar", limit=100)
    assert records[0].id == record.id
    assert await personal.update_memory(user_id="11", avatar_id="new-avatar", memory_id=record.id, content="喜欢喝温水")
    assert await personal.delete_memory(user_id="11", avatar_id="another-avatar", memory_id=record.id)
    assert await personal.list_memories(user_id="11", avatar_id="old-avatar") == []
