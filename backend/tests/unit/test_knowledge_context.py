from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from opentalking.agent.context_builder import AgentSessionConfig, build_agent_context


@pytest.mark.asyncio
async def test_retrieval_timeout_keeps_memory_and_reports_unavailable_knowledge():
    class Memories:
        async def list_memories(self, **kwargs):
            return [SimpleNamespace(content="喜欢简短回答")]

    class SlowKnowledge:
        async def query_many(self, **kwargs):
            await asyncio.sleep(10)

    config = AgentSessionConfig(user_id="11", agent_enabled=True, memory_enabled=True, knowledge_enabled=True, knowledge_base_ids=["kb-a"])
    context = await asyncio.wait_for(build_agent_context(config=config, avatar_id="a", query="保修", store=Memories(), knowledge_store=SlowKnowledge(), timeout_ms=30), timeout=0.5)
    assert "喜欢简短回答" in context
    assert "无法确认" in context


@pytest.mark.asyncio
async def test_retrieval_returns_bounded_context_with_structured_sources():
    class Knowledge:
        async def query_many(self, **kwargs):
            return [SimpleNamespace(id="chunk-1", doc_id="doc-1", kb_id="kb-a", filename="manual.md", text="保修三年。" * 4000)]

    sources = []
    context = await build_agent_context(config=AgentSessionConfig(user_id="11", agent_enabled=True, knowledge_enabled=True, knowledge_base_ids=["kb-a"]), avatar_id="a", query="保修", knowledge_store=Knowledge(), sources=sources)
    assert len(context) < 6000
    assert sources[0]["filename"] == "manual.md"
    assert sources[0]["doc_id"] == "doc-1"


def test_session_defaults_to_explicit_memory():
    from apps.api.modules.conversation.schemas import CreateSessionRequest

    assert CreateSessionRequest().memory_mode == "explicit"


def test_injected_context_budget_preserves_latest_user_message():
    from opentalking.agent.prompt import inject_agent_context

    messages = [{"role": "system", "content": "系统规则"}]
    for i in range(20):
        messages.extend([{"role": "user", "content": "历史问题" * 100}, {"role": "assistant", "content": "历史回答" * 100}])
    messages.append({"role": "user", "content": "最新的问题"})
    injected = inject_agent_context(messages, "资料" * 2000)
    assert sum(len(message["content"]) for message in injected) <= 11000
    assert injected[-1]["content"] == "最新的问题"
    assert injected[0]["content"] == "系统规则"


@pytest.mark.asyncio
async def test_session_memory_write_uses_same_account_store(tmp_path, monkeypatch):
    from opentalking.pipeline.session.runner import SessionRunner
    from opentalking.agent.context_builder import default_memory_store

    monkeypatch.setenv("OPENTALKING_AGENT_MEMORY_SQLITE_PATH", str(tmp_path / "agent.sqlite"))
    runner = SessionRunner.__new__(SessionRunner)
    runner.agent_config = AgentSessionConfig(user_id="11", agent_enabled=True, memory_enabled=True)
    runner.persona_id, runner.avatar_id, runner.session_id = None, "a", "sess-a"
    await runner._save_agent_turn(user_text="请记住：我喜欢蓝色。", assistant_text="好的")
    memories = await default_memory_store("11").list_memories(user_id="11", avatar_id="a")
    assert memories[0].content == "我喜欢蓝色"


@pytest.mark.asyncio
async def test_quicktalk_runner_exposes_retrieved_sources(monkeypatch):
    from opentalking.pipeline.speak import synthesis_runner

    async def context(**kwargs):
        if kwargs.get("sources") is not None:
            kwargs["sources"].append({"filename": "manual.txt", "doc_id": "d", "kb_id": "k"})
        return "保修三年"

    monkeypatch.setattr(synthesis_runner, "build_agent_context", context)
    runner = synthesis_runner.FlashTalkRunner.__new__(synthesis_runner.FlashTalkRunner)
    runner.agent_config = AgentSessionConfig(agent_enabled=True, knowledge_enabled=True, knowledge_base_ids=["k"])
    runner.persona_id, runner.avatar_id, runner.session_id = None, "a", "s"
    assert await runner._build_agent_context("保修多久") == "保修三年"
    assert runner._agent_sources[0]["filename"] == "manual.txt"


@pytest.mark.asyncio
async def test_lightrag_query_preserves_chunk_document_provenance(tmp_path, monkeypatch):
    from opentalking.agent.knowledge_index import LightRAGKnowledgeIndex

    class Chunks:
        async def get_by_id(self, chunk_id):
            assert chunk_id == "chunk-1"
            return {"full_doc_id": "doc-1", "content": "保修三年"}

    class RAG:
        text_chunks = Chunks()

        async def aquery_data(self, query, param):
            return {"status": "success", "data": {"chunks": [{"chunk_id": "chunk-1", "file_path": "manual.txt", "content": "保修三年"}]}}

        async def aquery(self, query, param):
            return "unstructured context without sources"

        async def finalize_storages(self):
            pass

    async def rag(kb_id):
        return RAG()

    index = LightRAGKnowledgeIndex(root=tmp_path)
    monkeypatch.setattr(index, "_new_rag", rag)
    results = await index._query_async(kb_id="k", query="保修", limit=3)
    assert results[0].doc_id == "doc-1"
    assert results[0].text == "保修三年"


@pytest.mark.asyncio
async def test_local_embedding_constructs_with_installed_lightrag(tmp_path):
    from opentalking.agent.knowledge_index import LightRAGKnowledgeIndex

    index = LightRAGKnowledgeIndex(root=tmp_path, embedding_dim=16)
    embedding = index._embedding_func()
    result = await embedding(["保修三年"])
    assert result.shape == (1, 16)


def test_installed_lightrag_indexes_and_returns_original_document(tmp_path):
    from opentalking.agent.knowledge_index import LightRAGKnowledgeIndex

    index = LightRAGKnowledgeIndex(root=tmp_path, embedding_dim=16)
    index.index_document(kb_id="kb-test", doc_id="doc-test", filename="manual.txt", text="蓝鲸产品保修三年。")
    results = index.query(kb_id="kb-test", query="蓝鲸产品保修三年", limit=3)
    assert results and results[0].doc_id == "doc-test"
    assert "保修三年" in results[0].text
