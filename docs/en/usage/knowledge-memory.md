# Knowledge and long-term memory

Open **Knowledge and memory** in the workbench, with **My materials** and **About me** tabs. Materials and memories are isolated by authenticated account.

## Document questions

1. Click **Add materials** or drop a TXT, Markdown, PDF or PPTX file, up to 20 MB. The first upload automatically creates and selects the My materials group. Later uploads use the currently viewed group. Optional group creation is available after onboarding.
2. Files show **Reading materials**, then **Ready for questions** when original passages are searchable. Deeper processing can continue in the background; failed processing offers a retry.
3. Use **Try a question** to inspect actual matching passages. This preview does not generate a complete answer; return to chat to continue. PDF extraction requires existing parser tools, and scanned files may need OCR.
4. Select groups to reference during chat. Chat shows the actual session settings separately from pending changes. **Reconnect and apply** releases the old session before starting a new connection; finish recording, saving or other work first. Desired settings are stored per account in the current browser and restored after refresh; they do not synchronize across browsers.
5. Assistant bubbles list the files retrieved for that turn. These are retrieval references, not sentence-level citation guarantees. Missing or timed-out retrieval explicitly instructs the model to acknowledge that a document-based answer cannot be confirmed.

Semantic/graph enrichment uses the existing `OPENTALKING_AGENT_LIGHTRAG_*` settings. Without a configured enrichment service, local keyword retrieval remains available; its behavior is not equivalent to semantic retrieval.

## Explicit memory

In **About me**, enable **Let the digital human remember me**. Examples for a preferred name, food preferences and conversation style prefill an editable form; they are only stored after clicking Save. You can also say “Please remember: I prefer short answers” in chat to save a fact asynchronously after the response. Ordinary conversation is not automatically extracted into long-term memory; negated and quoted remember phrases do not trigger storage.

You can add, edit and delete memories. Disabling memory prevents reads and writes in newly connected sessions without deleting existing entries. Personal memories belong to the signed-in account and remain available across avatar, voice and session changes. Other accounts cannot access them. Previously avatar-scoped entries are also listed and editable without re-adding them. Deleting memory does not erase the original message from an ongoing conversation.

For example, save “Call me Lin. I prefer mild food without cilantro, and a relaxed conversation style.” A later dinner recommendation can take these preferences into account. The form accepts personal facts directly; saving through chat still requires an explicit “Please remember…” request.

Public sessions use explicit memory without automatic Mem0 extraction. Legacy Mem0/persona data is not migrated automatically. Automatic summaries and automatic conflict resolution are deferred.

## API

- `GET/POST /knowledge/bases`: list or create account libraries.
- `DELETE /knowledge/bases/{kb_id}`: delete a library and its documents.
- `GET/POST /knowledge/bases/{kb_id}/documents`: list or upload using multipart field `file`; upload returns 202 before background indexing.
- `DELETE /knowledge/bases/{kb_id}/documents/{doc_id}`: delete a document.
- `POST /knowledge/bases/{kb_id}/documents/{doc_id}/retry`: retry indexing.
- `POST /knowledge/bases/{kb_id}/query`: preview retrieval using a `query` field.
- `GET /knowledge/memories`: list up to 100 personal memories for the account.
- `POST /knowledge/memories` and `PUT /knowledge/memories/{id}`: add/update with `content`; no avatar ID is required.
- `DELETE /knowledge/memories/{id}`: delete one personal memory. Legacy requests with `avatar_id` remain compatible, but that field no longer partitions personal memory.

Session creation accepts `memory_mode: "explicit"`, `memory_enabled`, `knowledge_enabled` and `knowledge_base_ids`. Ownership is derived from authentication; foreign libraries return 404. Authentication-disabled development uses the `local` scope without multi-user isolation.
