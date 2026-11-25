from __future__ import annotations

import logging
import sqlite3
import tempfile
from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field

from opentalking.agent.context_builder import default_knowledge_store, default_memory_store
from opentalking.agent.knowledge_store import (
    MAX_DOCUMENT_BYTES, SUPPORTED_EXTENSIONS, DuplicateKnowledgeDocumentError, KnowledgeStore,
)
from opentalking.core.identity import current_identity

router = APIRouter(prefix="/knowledge", tags=["knowledge"])
log = logging.getLogger(__name__)


def account_user_id() -> str:
    identity = current_identity.get()
    return str(identity.id) if identity else "local"


class BaseInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class QueryInput(BaseModel):
    query: str = Field(min_length=1, max_length=2000)


class MemoryInput(BaseModel):
    content: str = Field(min_length=1, max_length=512)


async def validate_knowledge_bases(kb_ids: list[str], user_id: str | None = None) -> KnowledgeStore:
    store = default_knowledge_store(user_id or account_user_id())
    if kb_ids:
        available = {base.id for base in await store.list_knowledge_bases()}
        if any(kb_id not in available for kb_id in kb_ids):
            raise HTTPException(404, "知识库不存在或无权访问。")
    return store


async def _index_document(store: KnowledgeStore, kb_id: str, doc_id: str, generation: int) -> None:
    try:
        await store.index_document_for_generation(kb_id=kb_id, doc_id=doc_id, generation=generation)
    except Exception:
        # KnowledgeStore persists error/ready_fast and diagnostics for retries.
        log.warning("knowledge document indexing failed: %s/%s", kb_id, doc_id, exc_info=True)


@router.get("/bases")
async def list_bases() -> dict:
    return {"bases": [asdict(base) for base in await default_knowledge_store(account_user_id()).list_knowledge_bases()]}


@router.post("/bases", status_code=201)
async def create_base(body: BaseInput) -> dict:
    if not body.name.strip():
        raise HTTPException(400, "请填写知识库名称。")
    return asdict(await default_knowledge_store(account_user_id()).create_knowledge_base(body.name.strip()))


@router.delete("/bases/{kb_id}", status_code=204)
async def delete_base(kb_id: str) -> Response:
    store = await validate_knowledge_bases([kb_id])
    await store.delete_knowledge_base(kb_id)
    return Response(status_code=204)


@router.get("/bases/{kb_id}/documents")
async def list_documents(kb_id: str) -> dict:
    store = await validate_knowledge_bases([kb_id])
    return {"documents": [asdict(doc) for doc in await store.list_documents(kb_id=kb_id)]}


@router.post("/bases/{kb_id}/documents", status_code=202)
async def upload_document(kb_id: str, file: UploadFile, background_tasks: BackgroundTasks) -> dict:
    store = await validate_knowledge_bases([kb_id])
    filename = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    if Path(filename).suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise HTTPException(400, "支持 TXT、Markdown、PDF 和 PPTX 文档。")
    content = await file.read(MAX_DOCUMENT_BYTES + 1)
    if not content or len(content) > MAX_DOCUMENT_BYTES:
        raise HTTPException(413 if content else 400, "文档不能为空，且不能超过 20 MB。")
    with tempfile.TemporaryDirectory(prefix="opentalking-knowledge-") as temp:
        source = Path(temp) / filename
        source.write_bytes(content)
        try:
            doc = await store.add_document_deferred(kb_id=kb_id, filename=filename, mime_type=file.content_type or "application/octet-stream", source_path=source)
        except DuplicateKnowledgeDocumentError as exc:
            raise HTTPException(409, "相同文档已存在。") from exc
        except ValueError as exc:
            raise HTTPException(400, "文档无法导入，请检查文件格式。") from exc
    background_tasks.add_task(_index_document, store, kb_id, doc.id, doc.generation)
    return asdict(doc)


@router.post("/bases/{kb_id}/documents/{doc_id}/retry", status_code=202)
async def retry_document(kb_id: str, doc_id: str, background_tasks: BackgroundTasks) -> dict:
    store = await validate_knowledge_bases([kb_id])
    if doc_id not in {doc.id for doc in await store.list_documents(kb_id=kb_id)}:
        raise HTTPException(404, "文档不存在。")
    doc = await store.request_reindex(kb_id=kb_id, doc_id=doc_id)
    background_tasks.add_task(_index_document, store, kb_id, doc_id, doc.generation)
    return asdict(doc)


@router.delete("/bases/{kb_id}/documents/{doc_id}", status_code=204)
async def delete_document(kb_id: str, doc_id: str) -> Response:
    store = await validate_knowledge_bases([kb_id])
    if not await store.delete_document(kb_id=kb_id, doc_id=doc_id):
        raise HTTPException(404, "文档不存在。")
    return Response(status_code=204)


@router.post("/bases/{kb_id}/query")
async def query_base(kb_id: str, body: QueryInput) -> dict:
    import asyncio

    store = await validate_knowledge_bases([kb_id])
    try:
        chunks = await asyncio.wait_for(store.query(kb_id=kb_id, query=body.query, limit=3), timeout=2)
    except TimeoutError as exc:
        raise HTTPException(504, "知识库检索超时，请稍后重试。") from exc
    return {"sources": [asdict(chunk) for chunk in chunks]}


@router.get("/memories")
async def list_memories() -> dict:
    user_id = account_user_id()
    memories = await default_memory_store(user_id).list_memories(user_id=user_id, avatar_id="__account__", limit=100)
    return {"memories": [asdict(memory) for memory in memories]}


@router.post("/memories", status_code=201)
async def create_memory(body: MemoryInput) -> dict:
    if not body.content.strip():
        raise HTTPException(400, "请填写希望记住的个人信息或喜好。")
    user_id = account_user_id()
    memory = await default_memory_store(user_id).save_memory(user_id=user_id, avatar_id="__account__", content=body.content.strip(), kind="explicit", importance=0.8)
    return asdict(memory)


@router.put("/memories/{memory_id}")
async def update_memory(memory_id: str, body: MemoryInput) -> dict:
    if not body.content.strip():
        raise HTTPException(400, "记忆内容不能为空。")
    user_id = account_user_id()
    store = default_memory_store(user_id)
    try:
        updated = await store.update_memory(user_id=user_id, avatar_id="__account__", memory_id=memory_id, content=body.content.strip())
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "相同记忆已存在，请保留一条或调整内容。") from exc
    if not updated:
        raise HTTPException(404, "记忆不存在。")
    return {"updated": True}


@router.delete("/memories/{memory_id}", status_code=204)
async def delete_memory(memory_id: str) -> Response:
    user_id = account_user_id()
    if not await default_memory_store(user_id).delete_memory(user_id=user_id, avatar_id="__account__", memory_id=memory_id):
        raise HTTPException(404, "记忆不存在。")
    return Response(status_code=204)
