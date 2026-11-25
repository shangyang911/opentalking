import { useEffect, useRef, useState } from 'react';
import { activityDescription, cancelOrder, createOrder, grantLabel, loadActivity, loadOrders, loadPlans, minutes, money, newRequestId, orderStatusLabel, planUsageText, type Activity, type Entitlements, type Order, type Plan } from './api';
import { DemoOrderActions } from './DemoOrderActions';

export type BillingSection = 'membership' | 'orders' | 'usage';
type ContentProps = { account: Entitlements | null; error: string; onRefresh: () => Promise<unknown>; section: BillingSection };
const date = (timestamp: number) => new Date(timestamp * 1000).toLocaleString('zh-CN');
const titles = { membership: '会员与额度', orders: '订单记录', usage: '使用记录' };
const button = 'rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-40';

export function QuotaSummary({ account }: { account: Entitlements }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, (account.vip_until || 0) - now);
  const vip = account.vip && remaining > 0;
  const expired = !!account.vip_until && remaining === 0;
  const unlimited = vip && account.unlimited && (!account.unlimited_until || account.unlimited_until > now);
  const validity = vip ? remaining < 86400 ? '不足 1 天' : `${Math.ceil(remaining / 86400)} 天` : expired ? '0 天' : '—';
  return <div className="space-y-4">
    <section aria-label="会员有效期" className="grid gap-3 sm:grid-cols-3">
      <article className="rounded-2xl border border-cyan-100 bg-cyan-50/60 p-5"><p className="text-xs text-cyan-700">会员状态</p><p className="mt-3 text-xl font-semibold text-cyan-950">{vip ? 'VIP 已开通' : expired ? 'VIP 已到期' : '尚未开通 VIP'}</p><p className="mt-2 text-xs leading-5 text-cyan-800">{unlimited ? '有效期内对话、视频不限总时长' : vip ? '按套餐享有对话与视频额度' : '开通月度 VIP，享有 30 天会员权益'}</p></article>
      <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs text-slate-500">VIP 到期时间</p><p className="mt-3 break-words text-lg font-semibold tracking-tight text-slate-950">{account.vip_until ? date(account.vip_until) : '—'}</p><p className="mt-2 text-xs leading-5 text-slate-400">{account.vip_until ? '以此时间为会员有效期截止时间' : '开通后显示到期时间'}</p></article>
      <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs text-slate-500">剩余有效期</p><p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{validity}</p><p className="mt-2 text-xs leading-5 text-slate-400">{vip ? '续费可延长有效期，不自动扣款' : expired ? '续费后恢复套餐会员权益' : '开通后开始计算'}</p></article>
    </section>
    {!unlimited && <section aria-label="可用额度"><h3 className="mb-3 text-sm font-semibold text-slate-700">{vip ? '套餐与剩余额度' : '试用与剩余额度'}</h3><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
    ['QuickTalk 可用时长', minutes(account.quicktalk_seconds), 'VIP、加量包和赠送时长'],
    ['对话可用总时长', minutes(account.conversation_seconds), '包含仅限轻量模式的免费时长'],
    ['视频可用时长', minutes(account.video_seconds), '按实际成片时长结算'],
    ['QuickTalk 体验', `${account.trials_remaining} 次`, `每次最多 ${account.trial_seconds} 秒`],
  ].map(([label, value, note]) => <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs text-slate-500">{label}</p><p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{value}</p><p className="mt-2 text-xs leading-5 text-slate-400">{note}</p></article>)}</div></section>}
  </div>;
}

export function MembershipContent({ account, error: accountError, onRefresh, section }: ContentProps) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [instructions, setInstructions] = useState('');
  const [paymentMode, setPaymentMode] = useState<'manual' | 'demo'>('manual');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [hasOlder, setHasOlder] = useState(false);
  const requestRef = useRef<{ plan: string; id: string } | null>(null);
  async function load() {
    if (section === 'usage') setActivity((await loadActivity()).activity);
    else {
      const catalog = await loadPlans(); setPlans(catalog.plans); setInstructions(catalog.payment_instructions); setPaymentMode(catalog.payment_mode);
      if (section === 'orders' || catalog.payment_mode === 'demo') { const own = await loadOrders(); setOrders(own.orders); setHasOlder(own.orders.length === 100); }
    }
    await onRefresh();
  }
  useEffect(() => {
    let active = true;
    void load().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '读取失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const waitingForApproval = orders.some(order => order.plan.payment_mode === 'demo' && ['pending', 'demo_submitted'].includes(order.status));
  useEffect(() => {
    if (paymentMode !== 'demo' || !waitingForApproval) return;
    const timer = setInterval(() => { void load().catch(reason => setError(String(reason))); }, 3000);
    return () => clearInterval(timer);
  }, [paymentMode, waitingForApproval]);
  async function act(action: () => Promise<unknown>, reload = true) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); if (reload) await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试'); }
    finally { setBusy(false); setLoading(false); }
  }
  async function purchase(plan: Plan) {
    if (!requestRef.current || requestRef.current.plan !== plan.id) requestRef.current = { plan: plan.id, id: newRequestId() };
    const order = await createOrder(plan.id, requestRef.current.id);
    requestRef.current = null;
    setNotice(order.plan.payment_mode === 'demo'
      ? `演示订单 ${order.id} 已创建。点击下方“模拟付款”，再到管理员后台确认开通；不会实际扣款。`
      : `订单 ${order.id} 已创建。请按收款说明联系管理员，付款时备注订单号；核实到账后权益生效，可在“订单记录”查看。`);
  }
  return <div className="space-y-5">
    {paymentMode === 'demo' && <p role="status" className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-900">会员演示模式：模拟付款 → 管理员确认 → VIP 与额度生效。不会实际扣款，关闭演示模式后演示权益不再可用。</p>}
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-slate-950">{titles[section]}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{{ membership: 'VIP 每期 30 天，可按月使用对话与视频创作。', orders: '查看购买内容、付款核实状态与权益发放情况。', usage: '最近 100 次任务的预留与实际结算，初始化等待不计时。' }[section]}</p></div><button disabled={busy || loading} onClick={() => void act(async () => undefined)} className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600 disabled:opacity-40">{busy ? '刷新中…' : '刷新'}</button></div>
    {(error || accountError) && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error || accountError}<button className="ml-3 underline" disabled={busy} onClick={() => void act(async () => undefined)}>重试</button></div>}
    {notice && <p role="status" className="break-all rounded-xl bg-cyan-50 p-4 text-sm leading-6 text-cyan-800">{notice}</p>}
    {section === 'membership' && <>
      {account && <QuotaSummary account={account} />}
      {account?.active && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{account.active.unlimited ? '当前任务进行中，VIP 不扣减总使用额度。' : `当前任务已预留 ${minutes(account.active.seconds)}，结束后结算并退回未用时长。`}</p>}
      <div className="grid gap-4 md:grid-cols-2">{plans.filter(plan => plan.kind !== 'pack' || !account?.unlimited).map(plan => <article key={plan.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6"><p className="text-xs font-semibold tracking-wide text-cyan-700">{plan.kind === 'vip' ? '月度会员 · 30 天' : '会员加量包'}</p><h3 className="mt-2 text-lg font-semibold">{plan.name}</h3><p className="my-5 text-3xl font-semibold">{money(plan.price_fen)}<span className="ml-2 text-xs font-normal text-slate-400">/ {plan.valid_days} 天</span></p><p className="mb-5 text-sm leading-7 text-slate-600">{plan.unlimited ? '有效期内对话、视频不限总时长' : planUsageText(plan)}<br />单次对话最多 {minutes(plan.max_session_seconds)}</p><button disabled={busy || (plan.kind === 'pack' && !account?.vip)} onClick={() => void act(() => purchase(plan))} className={`${button} mt-auto`}>{plan.kind === 'pack' ? account?.vip ? '购买加量包' : '开通 VIP 后可购买' : account?.vip ? '续费月度 VIP' : '开通月度 VIP'}</button></article>)}</div>
      {loading && <p role="status" className="text-sm text-slate-500">正在读取套餐…</p>}
      {!loading && !error && !plans.length && <p className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">套餐暂未上架，内测期间请联系管理员了解开通安排。</p>}
      <p className="text-xs leading-6 text-slate-500">不限时长月卡按有效期授权，期间对话、视频、试听与专属声音创建不扣减总额度；续费延长会员有效期，不自动扣款。单次任务仍有时长和并发限制。有限额度套餐则按实际使用时长结算。</p>
      {!!account?.grants?.length && <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="text-sm font-semibold">额度来源与有效期</h3><div className="mt-4 divide-y divide-slate-100">{account.grants.map(grant => <div key={grant.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div><p className="font-medium">{grant.unlimited ? 'VIP 不限时长权益' : grantLabel(grant.kind)}</p><p className="mt-1 text-xs text-slate-500">{planUsageText(grant)}</p></div><p className="text-xs text-slate-400">{grant.kind === 'free' ? '长期有效 · 仅限轻量对话' : `有效至 ${date(grant.expires_at)}`}</p></div>)}</div></section>}
    </>}
    {section === 'membership' && paymentMode === 'demo' && orders.filter(order => order.plan.payment_mode === 'demo' && ['pending', 'demo_submitted'].includes(order.status)).map(order => <article key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-200 bg-white p-4 text-sm"><div><p className="font-semibold">{order.plan.name} · {orderStatusLabel(order)}</p><p className="mt-2 break-all text-xs text-slate-400">{order.id}</p></div><DemoOrderActions order={order} admin={false} enabled busy={busy} onAction={(operation, message) => void act(async () => { await operation(); setNotice(message); })} /></article>)}
    {(section === 'membership' || section === 'orders') && paymentMode !== 'demo' && <section className="rounded-2xl border border-amber-100 bg-amber-50/70 p-5"><h3 className="text-sm font-semibold text-amber-900">内测付款与开通</h3><p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-amber-800">{instructions || '请先联系管理员确认收款方式，再按订单金额付款并备注订单号。'}{'\n'}付款后等待管理员核实，订单显示“已到账”时权益生效。</p></section>}
    {section === 'orders' && <>
      {loading && <p role="status" className="text-sm text-slate-500">正在读取订单…</p>}
      {orders.map(order => <article key={order.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5"><div className="min-w-0"><p className="font-medium">{order.plan.name} <span className="ml-2">{money(order.amount_fen)}</span></p><p className="mt-2 text-xs text-slate-500">{planUsageText(order.plan)} · {order.plan.valid_days} 天</p><p className="mt-2 break-all text-xs text-slate-400">{date(order.created_at)} · {order.id}</p></div><div className="flex items-center gap-3"><span className={`rounded-full px-3 py-1 text-xs ${order.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{orderStatusLabel(order)}</span><DemoOrderActions order={order} admin={false} enabled={paymentMode === 'demo'} busy={busy} onAction={(operation, message) => void act(async () => { await operation(); setNotice(message); })} />{['pending', 'demo_submitted'].includes(order.status) && <button disabled={busy} onClick={() => void act(() => cancelOrder(order.id))} className="text-xs text-slate-500 underline">取消订单</button>}</div></article>)}
      {!loading && !error && !orders.length && <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-400">暂无订单，购买套餐后可在这里查看。</p>}
      {hasOlder && <button disabled={busy} onClick={() => void act(async () => { const older = (await loadOrders(orders[orders.length - 1].created_at)).orders; setOrders(previous => [...previous, ...older]); setHasOlder(older.length === 100); }, false)} className="text-sm text-cyan-700">查看更早订单</button>}
    </>}
    {section === 'usage' && <>
      {loading && <p role="status" className="text-sm text-slate-500">正在读取使用记录…</p>}
      {activity.map(task => <article key={task.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-medium">{{ conversation: '实时对话', video: '视频生成', preview: '音色试听', clone: '专属声音创建' }[task.kind] || '语音服务'}{task.model === 'quicktalk' ? ' · QuickTalk' : ''}</h3><p className="text-xs text-slate-400">{date(task.created_at)}</p></div><p className="mt-3 text-sm text-cyan-800">{activityDescription(task)}</p><p className="mt-2 break-all text-xs text-slate-400">任务 {task.id}</p></article>)}
      {!loading && !error && !activity.length && <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-400">暂无使用记录，完成对话或视频任务后可在这里查看。</p>}
    </>}
  </div>;
}

export function MembershipDialog({ account, error, onClose, onRefresh }: Omit<ContentProps, 'section'> & { onClose: () => void }) {
  const [section, setSection] = useState<BillingSection>('membership');
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, textarea');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialog} role="dialog" aria-modal="true" aria-label="我的会员与额度" tabIndex={-1} className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-slate-50 p-5 shadow-2xl outline-none sm:p-8"><div className="mb-6 flex flex-wrap items-center justify-between gap-3"><nav className="flex gap-1 rounded-xl bg-slate-200/60 p-1" aria-label="会员信息">{(['membership', 'orders', 'usage'] as const).map(tab => <button key={tab} onClick={() => setSection(tab)} aria-current={tab === section ? 'page' : undefined} className={`rounded-lg px-3 py-2 text-xs ${section === tab ? 'bg-white font-semibold text-cyan-800 shadow-sm' : 'text-slate-500'}`}>{titles[tab]}</button>)}</nav><button onClick={onClose} aria-label="关闭会员窗口" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">关闭</button></div><MembershipContent key={section} account={account} error={error} section={section} onRefresh={onRefresh} /></div></div>;
}
