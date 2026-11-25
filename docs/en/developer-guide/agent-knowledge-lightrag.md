# Agent Knowledge LightRAG Notes

This page summarizes the LightRAG knowledge-base integration work. The Chinese page
contains the full implementation notes; this English page keeps the navigation entry
available until a full translation is written.

## Scope

The change keeps the existing knowledge-base, file-pool, avatar binding, and frontend
API flows, while routing retrieval through a LightRAG index by default.

Key implementation areas:

- `backend/opentalking/agent/knowledge_index.py` adds the LightRAG index adapter.
- `backend/opentalking/agent/knowledge_store.py` keeps metadata and document lifecycle
  handling, and delegates indexing and query to the index layer.
- `backend/apps/api/modules/conversation/sessions.py` adds runtime knowledge-base switching for active
  sessions.
- `frontend/src/app/App.tsx` and `frontend/src/features/settings/SettingsPanel.tsx` keep the
  selected knowledge base synchronized with the active realtime session.

## Runtime Behavior

Normal conversation retrieval uses LightRAG first. The old SQLite chunk-overlap
fallback is disabled by default and must be enabled explicitly through configuration.
The LightRAG-only diagnostic path never uses the fallback, so it can prove whether
LightRAG is installed and returning results.

For the full Chinese notes, switch the language selector to Chinese on this page.
