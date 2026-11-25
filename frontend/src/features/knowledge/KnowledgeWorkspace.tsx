import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import { availableKnowledgeIds, materialStatus, type KnowledgeSettings } from "./config";
import { SessionKnowledgeStatus } from "./SessionKnowledgeStatus";

type Props = {
  selectedIds: string[];
  onSelectedIds: (ids: string[]) => void;
  memoryEnabled: boolean;
  onMemoryEnabled: (enabled: boolean) => void;
  sessionLive: boolean;
  applied: KnowledgeSettings | null;
  onGoChat: () => void;
  onReconnect: () => void;
  reconnectDisabled?: boolean;
  reconnectReason?: string;
};

const input = "rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900";
const button = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const primary = "rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50";
const examples = [
  { label: "怎么称呼我", text: "请叫我小林。" },
  { label: "饮食喜好", text: "我喜欢清淡的食物，不吃香菜。" },
  { label: "聊天方式", text: "和我聊天时语气轻松一些，回答简短一点。" },
];

export function KnowledgeWorkspace({ selectedIds, onSelectedIds, memoryEnabled, onMemoryEnabled, sessionLive, applied, onGoChat, onReconnect, reconnectDisabled, reconnectReason }: Props) {
  const [tab, setTab] = useState<"knowledge" | "memory">("knowledge");
  const [bases, setBases] = useState<api.KnowledgeBase[]>([]);
  const [active, setActive] = useState("");
  const [documents, setDocuments] = useState<api.KnowledgeDocument[]>([]);
  const [memories, setMemories] = useState<api.Memory[]>([]);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<api.KnowledgeSource[] | null>(null);
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [basesLoaded, setBasesLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const loadBases = useCallback(async () => {
    const result = await api.listBases();
    setBases(result.bases);
    setBasesLoaded(true);
    setActive(previous => result.bases.some(base => base.id === previous) ? previous : result.bases[0]?.id ?? "");
  }, []);
  useEffect(() => {
    let alive = true;
    api.listBases().then(result => {
      if (!alive) return;
      setBases(result.bases); setBasesLoaded(true); setActive(result.bases[0]?.id ?? "");
    }).catch(err => alive && setError(String(err.message || err))).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!basesLoaded || busy) return;
    const available = availableKnowledgeIds(selectedIds, bases);
    if (available.length !== selectedIds.length) onSelectedIds(available);
  }, [bases, basesLoaded, busy, onSelectedIds, selectedIds]);
  useEffect(() => {
    setSources(null); setDocuments([]); setQuery("");
    if (!active) return;
    let alive = true;
    const refresh = () => api.listDocuments(active).then(result => { if (alive) setDocuments(result.documents); }).catch(err => { if (alive) setError(String(err.message || err)); });
    void refresh();
    const timer = setInterval(() => { if (!busyRef.current) void refresh(); }, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [active]);
  useEffect(() => {
    if (tab !== "memory") return;
    let alive = true;
    api.listMemories().then(result => { if (alive) setMemories(result.memories); }).catch(err => { if (alive) setError(String(err.message || err)); });
    return () => { alive = false; };
  }, [tab]);

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const refreshDocuments = async (id: string) => {
    const result = await api.listDocuments(id);
    if (activeRef.current === id) setDocuments(result.documents);
  };
  const upload = (file: File) => void run(async () => {
    try {
      const result = await api.uploadMaterial(file, active, bases, base => {
        setBases(previous => previous.some(item => item.id === base.id) ? previous : [...previous, base]);
        setActive(base.id);
      });
      onSelectedIds([...new Set([...selectedIds, result.base.id])]);
      setNotice("资料已添加，正在阅读。准备好后可以在下方试问一句。");
      // A list refresh cannot turn an accepted upload into an apparent failure.
      await loadBases().catch(() => undefined);
      if (activeRef.current === result.base.id) await refreshDocuments(result.base.id).catch(() => undefined);
    } catch (err) {
      // A retry should reuse a group even if the first file transfer failed.
      await loadBases().catch(() => undefined);
      throw err;
    }
  });
  const tryQuestion = async () => {
    if (!query.trim()) return;
    const id = active;
    await run(async () => {
      const result = await api.queryBase(id, query.trim());
      if (activeRef.current === id) setSources(result.sources);
    });
  };
  const readable = documents.some(doc => doc.status === "ready" || doc.status === "ready_fast");

  return <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 overflow-y-auto p-4 sm:p-7">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold tracking-wide text-cyan-700">知识与记忆</p><h1 className="mt-2 text-2xl font-semibold text-slate-950">让数字人更懂你</h1><p className="mt-2 text-sm leading-6 text-slate-600">添加它可以参考的资料，也告诉它你的称呼和喜好。内容仅对你的账号开放。</p></div>
      <button type="button" onClick={onGoChat} className={button}>返回聊天</button>
    </header>
    <SessionKnowledgeStatus applied={applied} selectedIds={selectedIds} memoryEnabled={memoryEnabled} live={sessionLive} onManage={onGoChat} managementLabel="返回聊天查看" onReconnect={onReconnect} reconnectDisabled={reconnectDisabled} reconnectReason={reconnectReason} />
    <div className="flex gap-1 border-b border-slate-200" role="tablist" aria-label="资料与个人记忆">
      {([['knowledge', '我的资料'], ['memory', '关于我']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setError(""); setNotice(""); }} className={`border-b-2 px-5 pb-3 pt-1 text-sm font-semibold ${tab === id ? "border-cyan-700 text-cyan-800" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{label}</button>)}
    </div>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><p>{error}</p><button type="button" className="underline disabled:opacity-50" disabled={busy} onClick={() => void run(async () => { await loadBases(); if (active) await refreshDocuments(active); if (tab === "memory") setMemories((await api.listMemories()).memories); })}>重新加载</button></div>}
    {notice && <p role="status" className="rounded-lg bg-cyan-50 px-4 py-3 text-sm text-cyan-900">{notice}</p>}
    {tab === "knowledge" ? <>
      <section onDragOver={event => { event.preventDefault(); if (!busy && !loading && basesLoaded) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); if (busy || loading || !basesLoaded) return; const file = event.dataTransfer.files[0]; if (file) upload(file); }} className={`rounded-xl border ${dragging ? "border-cyan-600 bg-cyan-50" : "border-slate-200 bg-white"} p-5 sm:p-7`}>
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div><h2 className="text-lg font-semibold text-slate-950">让数字人根据你的资料回答</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">上传产品介绍、课程笔记或常见问题。聊天时，它就能参考这些内容。</p><p className="mt-3 text-xs text-slate-500">TXT / Markdown / PDF / PPTX · 单份最多 20 MB · 可将文件拖到这里</p></div>
          <button type="button" className={primary} disabled={busy || loading || !basesLoaded} onClick={() => fileRef.current?.click()}>{busy ? "正在处理…" : "添加资料"}</button>
        </div>
        <input ref={fileRef} className="hidden" type="file" accept=".txt,.md,.markdown,.pdf,.pptx" aria-label="添加资料文件" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) upload(file); }} />
        {!loading && !bases.length && <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-cyan-800">从一份资料开始，添加后就能试着问出第一个问题。</p>}
        {loading && <p role="status" className="mt-4 text-sm text-slate-500">正在加载你的资料…</p>}
      </section>
      {!!bases.length && <div className="grid gap-6 md:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div><h2 className="text-sm font-semibold text-slate-900">资料分组</h2><p className="mt-1 text-xs leading-5 text-slate-500">勾选聊天时要参考的内容，点击分组查看资料。{sessionLive && "修改后需重新连接。"}</p></div>
          <ul className="space-y-2">{bases.map(base => <li key={base.id} className={`flex items-center gap-3 rounded-lg border p-3 ${active === base.id ? "border-cyan-600 bg-cyan-50" : "border-slate-200 bg-white"}`}>
            <input type="checkbox" aria-label={`聊天时参考${base.name}`} disabled={busy} checked={selectedIds.includes(base.id)} onChange={event => onSelectedIds(event.target.checked ? [...selectedIds, base.id] : selectedIds.filter(id => id !== base.id))} />
            <button type="button" disabled={busy} className="min-w-0 flex-1 truncate text-left text-sm font-medium" onClick={() => setActive(base.id)}>{base.name}</button>
          </li>)}</ul>
          <details><summary className="cursor-pointer text-xs font-medium text-cyan-700">新建分组</summary><form className="mt-3 flex gap-2" onSubmit={event => { event.preventDefault(); if (!name.trim()) return; void run(async () => { const base = await api.createBase(name.trim()); setName(""); await loadBases(); setActive(base.id); setNotice("分组已创建，点击添加资料即可上传到这里。"); }); }}><input className={`${input} min-w-0 flex-1`} aria-label="新分组名称" placeholder="如产品资料、课程笔记" value={name} maxLength={80} onChange={event => setName(event.target.value)} /><button className={button} disabled={busy || !name.trim()}>创建</button></form></details>
        </aside>
        <div className="min-w-0 space-y-5">
          {active && <>
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">{bases.find(base => base.id === active)?.name}</h2><button type="button" className="text-xs text-red-700 underline disabled:opacity-50" disabled={busy} onClick={() => { if (!window.confirm("删除此分组及其中的全部资料？")) return; void run(async () => { await api.deleteBase(active); onSelectedIds(selectedIds.filter(id => id !== active)); await loadBases(); }); }}>删除分组</button></div>
              <ul className="mt-3 divide-y divide-slate-100">{documents.map(doc => <li key={doc.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                <div className="min-w-0 flex-1"><p className="break-all text-sm font-medium text-slate-900">{doc.filename}</p><p role="status" className={`mt-1.5 text-xs ${doc.status === "ready" || doc.status === "ready_fast" ? "text-emerald-700" : doc.status === "error" ? "text-red-700" : "text-slate-500"}`}>{materialStatus(doc)}</p>{doc.status === "ready_fast" && <p className="mt-1 text-xs text-slate-500">可以根据原文查找内容，更深入的内容理解仍在准备。</p>}{doc.status === "error" && <p className="mt-1 text-xs text-slate-500">请检查文件是否包含可读取的文字，扫描件可能需要文字识别。</p>}</div>
                <div className="flex items-center gap-3 text-xs">{(doc.status === "ready" || doc.status === "ready_fast") && <button type="button" className="font-medium text-cyan-700 underline" onClick={() => queryRef.current?.focus()}>试问一句</button>}<button type="button" disabled={busy} className="text-slate-600 underline disabled:opacity-50" onClick={() => void run(async () => { await api.retryDocument(active, doc.id); await refreshDocuments(active); setNotice("已重新开始阅读这份资料。"); })}>{doc.status === "error" || doc.index_error ? "重新尝试" : "重新阅读"}</button><button type="button" disabled={busy} className="text-red-700 underline disabled:opacity-50" onClick={() => { if (window.confirm(`删除资料“${doc.filename}”？`)) void run(async () => { await api.deleteDocument(active, doc.id); setSources(null); await refreshDocuments(active); }); }}>删除</button></div>
              </li>)}</ul>
              {!documents.length && <p className="mt-5 text-sm text-slate-500">这个分组还没有资料，点击上方“添加资料”即可上传。</p>}
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-base font-semibold">试问一句</h2><p className="mt-2 text-xs leading-5 text-slate-500">输入一个资料里的问题，先看看它能找到哪些依据。完整回答可返回聊天体验。</p>
              <form className="mt-4 flex gap-2" onSubmit={event => { event.preventDefault(); void tryQuestion(); }}><input ref={queryRef} className={`${input} min-w-0 flex-1`} aria-label="试问一句" value={query} onChange={event => setQuery(event.target.value)} maxLength={2000} placeholder="例如：这款产品的保修期是多久？" /><button className={primary} disabled={busy || !readable || !query.trim()}>试一试</button></form>
              {!readable && <p className="mt-3 text-xs text-slate-500">等资料显示“可以提问”后，就能开始尝试。</p>}
              {sources !== null && (sources.length ? <div className="mt-5"><p className="text-xs font-semibold text-cyan-800">从资料中找到了这些内容</p><ul className="mt-3 space-y-3">{sources.map((source, index) => <li key={`${source.doc_id}-${index}`} className="rounded-lg bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-700">{source.filename}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{source.text}</p></li>)}</ul><button type="button" onClick={onGoChat} className={`${button} mt-4`}>去聊天，结合资料继续问</button></div> : <p role="status" className="mt-4 text-sm leading-6 text-slate-600">暂时没有找到相关内容。试试资料里出现的名称或关键词，也可以补充一份相关资料。</p>)}
            </section>
          </>}
        </div>
      </div>}
    </> : <section className="max-w-3xl space-y-6">
      <div><h2 className="text-lg font-semibold">你希望它了解你什么？</h2><p className="mt-2 text-sm leading-6 text-slate-600">这些记忆属于你的账号，换数字人也能继续使用。你随时可以修改或删除。</p></div>
      <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-5"><input className="mt-1" type="checkbox" checked={memoryEnabled} onChange={event => onMemoryEnabled(event.target.checked)} /><span><span className="block text-sm font-semibold">让数字人记住我</span><span className="mt-1.5 block text-xs leading-5 text-slate-500">开启后，聊天会参考你保存的称呼和喜好。也可以在聊天中说“请记住……”。普通聊天不会自动保存。</span></span></label>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void run(async () => { await api.saveMemory(content.trim(), editing); setContent(""); setEditing(undefined); setMemories((await api.listMemories()).memories); setNotice("已保存到你的个人记忆。"); }); }}>
        <label htmlFor="personal-memory" className="block text-sm font-semibold">{editing ? "修改个人记忆" : "告诉它一点关于你的事"}</label>
        <div className="flex flex-wrap gap-2">{examples.map(example => <button key={example.label} type="button" disabled={busy} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-cyan-600" onClick={() => { setEditing(undefined); setContent(example.text); }}>{example.label}</button>)}</div>
        <p className="text-xs text-slate-500">点击示例可以修改，保存后才会记住。</p>
        <textarea id="personal-memory" className={`${input} min-h-28 w-full`} aria-label="记忆内容" value={content} maxLength={512} onChange={event => setContent(event.target.value)} placeholder="例如：叫我小林；我喜欢清淡的食物，不吃香菜；聊天时希望你语气轻松。" />
        <div className="flex gap-2"><button className={primary} disabled={busy || !content.trim()}>{editing ? "保存修改" : "保存这条记忆"}</button>{editing && <button type="button" className={button} onClick={() => { setEditing(undefined); setContent(""); }}>取消编辑</button>}</div>
      </form>
      <section><h3 className="text-sm font-semibold">它已经了解的你</h3><ul className="mt-2 divide-y divide-slate-200">{memories.map(memory => <li key={memory.id} className="flex items-start justify-between gap-4 py-4"><p className="whitespace-pre-wrap break-words text-sm leading-6">{memory.content}</p><div className="flex shrink-0 gap-3 text-xs"><button type="button" className="text-cyan-700 underline" disabled={busy} onClick={() => { setEditing(memory.id); setContent(memory.content); }}>编辑</button><button type="button" className="text-red-700 underline" disabled={busy} onClick={() => { if (window.confirm("删除这条个人记忆？")) void run(async () => { await api.deleteMemory(memory.id); setMemories((await api.listMemories()).memories); if (editing === memory.id) { setEditing(undefined); setContent(""); } setNotice("这条个人记忆已删除。"); }); }}>删除</button></div></li>)}</ul>{!memories.length && <p className="mt-3 text-sm leading-6 text-slate-500">可以先告诉它怎么称呼你，或从一条饮食喜好开始。</p>}</section>
    </section>}
  </main>;
}
