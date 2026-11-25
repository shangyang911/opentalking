from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path

from opentalking.agent.knowledge_store import KnowledgeStore
from opentalking.agent.memory_store import AgentMemoryStore
from opentalking.agent.prompt import build_agent_context_prompt


@dataclass(frozen=True)
class AgentSessionConfig:
    user_id: str | None = None
    agent_enabled: bool = False
    memory_enabled: bool = False
    knowledge_enabled: bool = False
    knowledge_base_id: str | None = None
    knowledge_base_ids: list[str] | None = None

    @property
    def has_memory(self) -> bool:
        return bool(self.agent_enabled and self.memory_enabled and self.user_id)

    @property
    def has_knowledge(self) -> bool:
        return bool(
            self.agent_enabled
            and self.knowledge_enabled
            and self.selected_knowledge_base_ids
        )

    @property
    def selected_knowledge_base_ids(self) -> list[str]:
        selected: list[str] = []
        seen: set[str] = set()
        candidates = (
            self.knowledge_base_ids
            if self.knowledge_base_ids
            else [self.knowledge_base_id]
        )
        for candidate in candidates:
            kb_id = str(candidate or "").strip()
            if not kb_id or kb_id in seen:
                continue
            selected.append(kb_id)
            seen.add(kb_id)
        return selected


def account_path(path: str | Path, user_id: str | None) -> Path:
    base = Path(path)
    if not user_id:
        return base
    # Hash arbitrary legacy IDs too: no identifier can become a path traversal.
    key = hashlib.sha256(user_id.encode()).hexdigest()[:32]
    return base.parent / "accounts" / key / base.name


def default_memory_store(user_id: str | None = None) -> AgentMemoryStore:
    from opentalking.core.config import get_settings

    settings = get_settings()
    return AgentMemoryStore(account_path(settings.agent_memory_sqlite_path, user_id), account_scope=bool(user_id))


def default_knowledge_store(user_id: str | None = None) -> KnowledgeStore:
    from opentalking.core.config import get_settings

    settings = get_settings()
    from opentalking.agent.knowledge_index import default_knowledge_index

    root = account_path(settings.agent_knowledge_root, user_id)
    index_root = account_path(
        settings.agent_lightrag_root or str(Path(settings.agent_knowledge_root) / "_lightrag"),
        user_id,
    )
    return KnowledgeStore(
        db_path=account_path(settings.agent_memory_sqlite_path, user_id),
        knowledge_root=root,
        knowledge_index=default_knowledge_index(root, root_override=index_root),
        use_chunk_fallback=True,
    )


async def build_agent_context(
    *,
    config: AgentSessionConfig,
    avatar_id: str,
    query: str = "",
    store: AgentMemoryStore | None = None,
    knowledge_store: KnowledgeStore | None = None,
    timeout_ms: int = 1500,
    sources: list[dict[str, str]] | None = None,
) -> str | None:
    async def recall_memories():
        if not config.has_memory:
            return []
        memory_store = store or default_memory_store(config.user_id)
        return await memory_store.list_memories(
            user_id=str(config.user_id),
            avatar_id=avatar_id,
            limit=8,
        )

    async def recall_knowledge():
        if not config.has_knowledge or not query.strip():
            return []
        kb_store = knowledge_store or default_knowledge_store(config.user_id)
        return await kb_store.query_many(
            kb_ids=config.selected_knowledge_base_ids,
            query=query,
            limit=3,
        )

    async def bounded(coro):
        try:
            return await asyncio.wait_for(coro, timeout=max(1, timeout_ms) / 1000)
        except Exception:
            logging.getLogger(__name__).warning("agent context retrieval unavailable", exc_info=True)
            return []

    memories, chunks = await asyncio.gather(bounded(recall_memories()), bounded(recall_knowledge()))
    knowledge_chunks = []
    for chunk in chunks[:3]:
        if not chunk.text.strip():
            continue
        knowledge_chunks.append(f"source: {chunk.filename[:160]}\n{chunk.text[:1200]}")
        if sources is not None:
            sources.append({"filename": chunk.filename, "doc_id": chunk.doc_id, "kb_id": chunk.kb_id})
    if config.has_knowledge and not knowledge_chunks:
        knowledge_chunks = ["本次未获得可用的知识库资料（可能无匹配内容或检索暂不可用）。对需要资料支撑的问题，请明确说明无法确认，不要编造。"]
    return build_agent_context_prompt(memories=memories, knowledge_chunks=knowledge_chunks)
