export function knowledgeSessionFields(ids: string[], memoryEnabled: boolean) {
  const selected = [...new Set(ids.map(id => id.trim()).filter(Boolean))];
  return {
    agent_enabled: memoryEnabled || selected.length > 0,
    memory_enabled: memoryEnabled,
    memory_mode: "explicit" as const,
    knowledge_enabled: selected.length > 0,
    knowledge_base_id: selected[0] ?? "",
    knowledge_base_ids: selected,
  };
}

export type KnowledgeSettings = { ids: string[]; memoryEnabled: boolean };

export function availableKnowledgeIds(ids: string[], bases: { id: string }[]): string[] {
  const available = new Set(bases.map(base => base.id));
  return ids.filter(id => available.has(id));
}

export const knowledgeSettingsKey = (accountId?: number) => `opentalking-knowledge-settings:${accountId ?? "local"}`;

export function parseKnowledgeSettings(raw: string | null): KnowledgeSettings {
  try {
    const value = JSON.parse(raw ?? "null");
    return {
      ids: Array.isArray(value?.ids) ? [...new Set<string>(value.ids.filter((id: unknown): id is string => typeof id === "string" && !!id.trim()).map((id: string) => id.trim()))] : [],
      memoryEnabled: value?.memoryEnabled === true,
    };
  } catch { return { ids: [], memoryEnabled: false }; }
}

export function knowledgeSettingsChanged(applied: KnowledgeSettings, ids: string[], memoryEnabled: boolean): boolean {
  const normalize = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))].sort();
  return applied.memoryEnabled !== memoryEnabled || JSON.stringify(normalize(applied.ids)) !== JSON.stringify(normalize(ids));
}

export function materialStatus(document: { status: string; index_error: string | null }): string {
  if (document.status === "ready" || document.status === "ready_fast") return "可以提问";
  if (document.status === "error") return "阅读失败，请重试";
  return "正在阅读资料";
}
