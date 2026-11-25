from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from opentalking.core.identity import Identity, current_identity


@pytest.fixture
def knowledge_client(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENTALKING_AGENT_MEMORY_SQLITE_PATH", str(tmp_path / "agent.sqlite"))
    monkeypatch.setenv("OPENTALKING_AGENT_KNOWLEDGE_ROOT", str(tmp_path / "knowledge"))
    monkeypatch.setenv("OPENTALKING_AGENT_LIGHTRAG_ROOT", str(tmp_path / "custom-index"))
    from opentalking.core.config import get_settings

    get_settings.cache_clear()
    from apps.api.modules.knowledge.router import router
    from opentalking.agent.knowledge_index import LightRAGKnowledgeIndex

    monkeypatch.setattr(LightRAGKnowledgeIndex, "index_document", lambda self, **kw: None)
    monkeypatch.setattr(LightRAGKnowledgeIndex, "query", lambda self, **kw: [])
    monkeypatch.setattr(LightRAGKnowledgeIndex, "delete_document", lambda self, **kw: None)
    monkeypatch.setattr(LightRAGKnowledgeIndex, "clear_knowledge_base", lambda self, *a, **kw: None)
    app = FastAPI()

    @app.middleware("http")
    async def identify(request, call_next):
        token = current_identity.set(Identity(int(request.headers.get("test-account", "11")), "user"))
        try:
            return await call_next(request)
        finally:
            current_identity.reset(token)

    app.include_router(router)
    from apps.api.modules.conversation.sessions import router as session_router
    from opentalking.core.in_memory_redis import InMemoryRedis

    app.state.redis = InMemoryRedis()
    app.include_router(session_router)
    with TestClient(app) as client:
        yield client
    get_settings.cache_clear()


def test_account_cannot_read_delete_or_query_another_accounts_library(knowledge_client):
    client = knowledge_client
    kb = client.post("/knowledge/bases", json={"name": "我的资料"}).json()
    assert client.get("/knowledge/bases").json()["bases"][0]["id"] == kb["id"]
    other = {"test-account": "22"}
    assert client.get("/knowledge/bases", headers=other).json()["bases"] == []
    assert client.get(f'/knowledge/bases/{kb["id"]}/documents', headers=other).status_code == 404
    assert client.post(f'/knowledge/bases/{kb["id"]}/query', json={"query": "资料"}, headers=other).status_code == 404
    assert client.delete(f'/knowledge/bases/{kb["id"]}', headers=other).status_code == 404


def test_upload_query_delete_document(knowledge_client):
    client = knowledge_client
    kb = client.post("/knowledge/bases", json={"name": "产品"}).json()["id"]
    uploaded = client.post(f"/knowledge/bases/{kb}/documents", files={"file": ("manual.txt", "蓝鲸产品保修期限为三年。".encode(), "text/plain")})
    assert uploaded.status_code == 202
    docs = client.get(f"/knowledge/bases/{kb}/documents").json()["documents"]
    assert len(docs) == 1 and docs[0]["status"] in {"ready", "ready_fast"}
    result = client.post(f"/knowledge/bases/{kb}/query", json={"query": "蓝鲸产品保修期限"}).json()
    assert result["sources"][0]["filename"] == "manual.txt"
    assert "三年" in result["sources"][0]["text"]
    assert client.delete(f'/knowledge/bases/{kb}/documents/{docs[0]["id"]}').status_code == 204
    assert client.post(f"/knowledge/bases/{kb}/query", json={"query": "蓝鲸产品"}).json()["sources"] == []


def test_memory_crud_and_account_isolation(knowledge_client):
    client = knowledge_client
    created = client.post("/knowledge/memories", json={"avatar_id": "avatar-a", "content": "我喜欢简短回答"})
    assert created.status_code == 201
    memory = created.json()
    assert client.get("/knowledge/memories?avatar_id=avatar-a").json()["memories"][0]["content"] == "我喜欢简短回答"
    other = {"test-account": "22"}
    assert client.get("/knowledge/memories?avatar_id=avatar-a", headers=other).json()["memories"] == []
    assert client.delete(f'/knowledge/memories/{memory["id"]}?avatar_id=avatar-a', headers=other).status_code == 404
    assert client.put(f'/knowledge/memories/{memory["id"]}', json={"avatar_id": "avatar-a", "content": "我喜欢详细回答"}).status_code == 200
    assert client.delete(f'/knowledge/memories/{memory["id"]}?avatar_id=avatar-a').status_code == 204
    assert client.get("/knowledge/memories?avatar_id=avatar-a").json()["memories"] == []


def test_personal_memory_api_needs_no_avatar_and_ignores_legacy_avatar_scope(knowledge_client):
    client = knowledge_client
    created = client.post("/knowledge/memories", json={"content": "叫我小林，我喜欢清淡的食物"})
    assert created.status_code == 201
    memory = created.json()
    assert client.get("/knowledge/memories").json()["memories"][0]["id"] == memory["id"]
    assert client.get("/knowledge/memories?avatar_id=different-avatar").json()["memories"][0]["id"] == memory["id"]
    assert client.get("/knowledge/memories", headers={"test-account": "22"}).json()["memories"] == []
    assert client.put(f'/knowledge/memories/{memory["id"]}', json={"content": "喜欢清淡食物，不吃香菜"}).status_code == 200
    assert client.delete(f'/knowledge/memories/{memory["id"]}', headers={"test-account": "22"}).status_code == 404
    assert client.delete(f'/knowledge/memories/{memory["id"]}').status_code == 204


def test_scoped_indexes_do_not_share_custom_root(knowledge_client):
    from opentalking.agent.context_builder import default_knowledge_store

    first = default_knowledge_store("11")
    second = default_knowledge_store("22")
    assert first.db_path != second.db_path
    assert first.knowledge_root != second.knowledge_root
    assert first.knowledge_index.root != second.knowledge_index.root


def test_session_cannot_bind_another_accounts_knowledge_base(knowledge_client):
    import asyncio

    client = knowledge_client
    kb = client.post("/knowledge/bases", json={"name": "私有资料"}).json()["id"]
    asyncio.run(client.app.state.redis.hset("opentalking:session:sess-test", mapping={"session_id": "sess-test", "user_id": "22"}))
    response = client.post("/sessions/sess-test/knowledge-bases", json={"knowledge_base_ids": [kb]}, headers={"test-account": "22"})
    assert response.status_code == 404


def test_failed_enrichment_keeps_document_queryable_and_retryable(knowledge_client, monkeypatch):
    from opentalking.agent.knowledge_index import LightRAGKnowledgeIndex

    def unavailable(self, **kwargs):
        raise RuntimeError("upstream unavailable")

    monkeypatch.setattr(LightRAGKnowledgeIndex, "index_document", unavailable)
    client = knowledge_client
    kb = client.post("/knowledge/bases", json={"name": "离线资料"}).json()["id"]
    response = client.post(f"/knowledge/bases/{kb}/documents", files={"file": ("manual.txt", "蓝鲸保修三年。".encode(), "text/plain")})
    assert response.status_code == 202
    doc = client.get(f"/knowledge/bases/{kb}/documents").json()["documents"][0]
    assert doc["status"] == "ready_fast"
    assert doc["index_error"]
    assert client.post(f"/knowledge/bases/{kb}/query", json={"query": "蓝鲸保修"}).json()["sources"]
    monkeypatch.setattr(LightRAGKnowledgeIndex, "index_document", lambda self, **kwargs: None)
    assert client.post(f'/knowledge/bases/{kb}/documents/{doc["id"]}/retry').status_code == 202
    assert client.get(f"/knowledge/bases/{kb}/documents").json()["documents"][0]["status"] == "ready"


@pytest.mark.parametrize("text", ["不要记住我的名字", "请别记住这句话", "你还记得我吗", '文档中说“记住密码”', "I don't want you to remember this password"])
def test_negated_or_quoted_memory_request_is_not_saved(text):
    from opentalking.agent.memory_store import extract_explicit_memory

    assert extract_explicit_memory(text) is None


def test_remembering_is_not_an_explicit_memory_request():
    from opentalking.agent.memory_store import extract_explicit_memory

    assert extract_explicit_memory("Remembering birthdays is difficult") is None


def test_editing_memory_to_duplicate_returns_conflict(knowledge_client):
    client = knowledge_client
    client.post("/knowledge/memories", json={"avatar_id": "a", "content": "喜欢蓝色"})
    other = client.post("/knowledge/memories", json={"avatar_id": "a", "content": "喜欢红色"}).json()
    response = client.put(f'/knowledge/memories/{other["id"]}', json={"avatar_id": "a", "content": "喜欢蓝色"})
    assert response.status_code == 409
    assert len(client.get("/knowledge/memories?avatar_id=a").json()["memories"]) == 2
