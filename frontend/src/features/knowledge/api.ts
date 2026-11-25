import { apiDelete, apiGet, apiPost, apiPut, apiUploadFile } from "../../shared/api/client";

export type KnowledgeBase = { id: string; name: string; document_count: number };
export type KnowledgeDocument = { id: string; filename: string; status: string; error: string | null; index_error: string | null; chunk_count: number };
export type Memory = { id: string; content: string; updated_at: string };
export type KnowledgeSource = { filename: string; doc_id: string; kb_id: string; text: string; score: number };
const basePath = (id: string) => `/knowledge/bases/${encodeURIComponent(id)}`;

export const listBases = () => apiGet<{ bases: KnowledgeBase[] }>("/knowledge/bases");
export const createBase = (name: string) => apiPost<KnowledgeBase>("/knowledge/bases", { name });
export const deleteBase = (id: string) => apiDelete(basePath(id));
export const listDocuments = (id: string) => apiGet<{ documents: KnowledgeDocument[] }>(`${basePath(id)}/documents`);
export const uploadDocument = (id: string, file: File) => apiUploadFile<KnowledgeDocument>(`${basePath(id)}/documents`, "file", file);
export const deleteDocument = (id: string, docId: string) => apiDelete(`${basePath(id)}/documents/${encodeURIComponent(docId)}`);
export const retryDocument = (id: string, docId: string) => apiPost(`${basePath(id)}/documents/${encodeURIComponent(docId)}/retry`);
export const queryBase = (id: string, query: string) => apiPost<{ sources: KnowledgeSource[] }>(`${basePath(id)}/query`, { query });
export const listMemories = () => apiGet<{ memories: Memory[] }>("/knowledge/memories");
export const saveMemory = (content: string, id?: string) => id
  ? apiPut(`/knowledge/memories/${encodeURIComponent(id)}`, { content })
  : apiPost("/knowledge/memories", { content });
export const deleteMemory = (id: string) => apiDelete(`/knowledge/memories/${encodeURIComponent(id)}`);

/** Opening the workspace never creates data; the first valid upload does. */
export async function uploadMaterial(file: File, activeId: string, bases: KnowledgeBase[], onBaseReady?: (base: KnowledgeBase) => void) {
  if (!/\.(txt|md|markdown|pdf|pptx)$/i.test(file.name)) throw new Error("支持 TXT、Markdown、PDF 和 PPTX 资料。");
  if (!file.size) throw new Error("资料内容不能为空，请换一份文件。");
  if (file.size > 20 * 1024 * 1024) throw new Error("单份资料不能超过 20 MB。");
  const base = bases.find(item => item.id === activeId)
    ?? bases.find(item => item.name === "我的资料")
    ?? bases[0]
    ?? await createBase("我的资料");
  onBaseReady?.(base);
  const document = await uploadDocument(base.id, file);
  return { base, document };
}
