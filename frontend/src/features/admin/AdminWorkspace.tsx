import { useCallback, useEffect, useState } from "react";
import { BillingAdmin } from "../billing/BillingAdmin";
import { money } from "../billing/api";
import { apiGet } from "../../shared/api/client";
import { type Account, accountLabel } from "../auth/api";
import { RuntimeConfigWorkspace } from "../settings/RuntimeConfigWorkspace";
import { applyRuntimeConfig, loadRuntimeConfig, type RuntimeConfigApplyInput, type RuntimeConfigResponse } from "../settings/api";

type Overview = { user_count: number; new_users_24h: number; revenue: { status: string; amount_fen: number | null; currency: string } };

export function AdminWorkspace({ account, onLogout, billingEnabled = false }: { account: Account; onLogout: () => Promise<void>; billingEnabled?: boolean }) {
  const [tab, setTab] = useState<"overview" | "settings">("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [config, setConfig] = useState<RuntimeConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [nextOverview, nextConfig] = await Promise.all([apiGet<Overview>("/admin/overview"), loadRuntimeConfig()]);
      setOverview(nextOverview); setConfig(nextConfig);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "后台数据读取失败。"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function apply(input: RuntimeConfigApplyInput) {
    setApplying(true); setError(""); setNotice("");
    try { setConfig(await applyRuntimeConfig(input)); setNotice("运行配置已保存。"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败。"); }
    finally { setApplying(false); }
  }

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4 lg:px-10"><a href="/admin" className="flex items-center gap-3 font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-cyan-300">✦</span>OpenTalking <span className="border-l border-slate-200 pl-3 text-sm font-normal text-slate-500">管理后台</span></a><div className="flex items-center gap-5 text-xs"><span className="text-slate-500">{accountLabel(account)}</span><a href="/" className="text-cyan-700 hover:underline">用户工作台</a><button onClick={() => void onLogout().catch((reason) => setError(String(reason)))} className="rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50">退出登录</button></div></header>
    <div className="mx-auto grid max-w-[1440px] gap-8 px-5 py-8 md:grid-cols-[200px_minmax(0,1fr)] lg:px-10"><nav aria-label="后台导航" className="flex gap-2 md:flex-col"><p className="mb-3 hidden px-3 text-[10px] font-semibold tracking-widest text-slate-400 md:block">管理中心</p>{([["overview", "运营概览"], ["settings", "运行配置"]] as const).map(([id, label]) => <button key={id} onClick={() => { setTab(id); setNotice(""); }} aria-current={tab === id ? "page" : undefined} className={`rounded-lg px-4 py-3 text-left text-sm font-medium transition ${tab === id ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-200/60"}`}>{label}</button>)}</nav>
      <main className="min-w-0"><div className="mb-8 flex items-center justify-between gap-4"><div><p className="text-xs text-slate-500">管理中心 / {tab === "overview" ? "运营概览" : "运行配置"}</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">{tab === "overview" ? "运营概览" : "运行配置"}</h1></div><button onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 disabled:opacity-50">{loading ? "刷新中…" : "刷新数据"}</button></div>
        {error && <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mb-5 text-sm text-emerald-700">{notice}</p>}
        {tab === "settings" ? <RuntimeConfigWorkspace runtimeConfig={config} runtimeConfigLoading={loading} runtimeConfigApplying={applying} onRuntimeConfigRefresh={() => void refresh()} onRuntimeConfigApply={apply} /> : <>
          <section aria-label="运营指标" className="grid gap-4 sm:grid-cols-3">{[["累计注册用户", overview?.user_count?.toLocaleString() ?? "—", "已完成手机验证的用户"], ["近 24 小时新增", overview?.new_users_24h?.toLocaleString() ?? "—", "滚动统计最近 24 小时"], ["净收款", overview?.revenue.amount_fen != null ? money(overview.revenue.amount_fen) : "—", "已确认到账减去已登记退款"]].map(([label, value, detail]) => <article key={label} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/40"><p className="text-xs font-medium text-slate-500">{label}</p><p className="my-5 text-4xl font-semibold tracking-tight tabular-nums">{value}</p><p className="text-xs text-slate-400">{detail}</p></article>)}</section>
          {billingEnabled && <BillingAdmin onChanged={refresh} />}
          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-sm font-semibold">账号与服务</h2><div className="mt-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500"><p>用户通过手机验证码登录，管理员账号由平台预设。</p><button onClick={() => setTab("settings")} className="font-medium text-cyan-700">管理运行配置 →</button></div></section>
        </>}
      </main></div>
  </div>;
}
