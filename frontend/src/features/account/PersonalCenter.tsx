import { useEffect, useRef, useState } from 'react';
import type { Account } from '../auth/api';
import type { Entitlements } from '../billing/api';
import { MembershipContent, QuotaSummary } from '../billing/MembershipDialog';
import { accountDisplayName, profileAvatarSrc, type Profile } from './api';
import { PasswordEditor, ProfileEditor } from './ProfileEditor';

type Tab = 'overview' | 'membership' | 'orders' | 'usage' | 'profile' | 'security';
const tabs: [Tab, string, string][] = [['overview', '账户概览', '◈'], ['membership', '会员与额度', '◇'], ['orders', '订单记录', '▤'], ['usage', '使用记录', '◷'], ['profile', '个人资料', '○'], ['security', '账户安全', '⌑']];

export function PersonalCenter({ account, profile, profileError, onProfileChange, onReloadProfile, entitlements, billingError, billingEnabled, onRefreshBilling, onClose }: {
  account: Account; profile: Profile | null; profileError: string; onProfileChange: (profile: Profile) => void;
  onReloadProfile: () => void; entitlements: Entitlements | null; billingError: string; billingEnabled: boolean;
  onRefreshBilling: () => Promise<unknown>; onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const name = accountDisplayName(account, profile);
  const avatar = profileAvatarSrc(profile?.avatar_url);
  const visibleTabs = tabs.filter(([id]) => billingEnabled || !['membership', 'orders', 'usage'].includes(id));
  return <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-50 text-slate-900" aria-label="个人中心">
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur sm:px-8"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-cyan-300">✦</span><p className="text-sm font-semibold">OpenTalking <span className="ml-2 border-l border-slate-200 pl-3 font-normal text-slate-500">个人中心</span></p></div><button onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">← 返回工作台</button></header>
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-9"><div className="mb-8 flex items-center gap-5"><div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-100 to-sky-50 text-2xl font-semibold text-cyan-800 ring-4 ring-white sm:h-20 sm:w-20">{avatar ? <img src={avatar} alt="账户头像" className="h-full w-full object-cover" /> : name.slice(0, 1)}</div><div className="min-w-0"><h1 ref={heading} tabIndex={-1} className="truncate text-2xl font-semibold tracking-tight outline-none">{name}</h1><p className="mt-2 truncate text-sm text-slate-500">{profile?.signature || '欢迎回到你的数字创作空间'}</p><p className="mt-2 text-xs text-slate-400">用户 ID · {account.id}</p></div><span className={`ml-auto shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${entitlements?.vip ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-500'}`}>{entitlements?.vip ? 'VIP 会员' : '普通用户'}</span></div>
      <div className="grid items-start gap-6 md:grid-cols-[180px_minmax(0,1fr)] lg:gap-10"><nav aria-label="个人中心导航" className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 md:sticky md:top-24 md:flex-col">{visibleTabs.map(([id, label, icon]) => <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 whitespace-nowrap rounded-xl px-4 py-3 text-sm transition ${tab === id ? 'bg-cyan-50 font-semibold text-cyan-800' : 'text-slate-500 hover:bg-slate-50'}`}><span aria-hidden="true" className="text-base">{icon}</span>{label}</button>)}</nav>
        <main className="min-w-0 pb-10">
          {profileError && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{profileError}<button onClick={onReloadProfile} className="ml-3 underline">重新读取资料</button></p>}
          {tab === 'overview' && <div className="space-y-6"><div><p className="text-xs font-semibold tracking-widest text-cyan-700">MY ACCOUNT</p><h2 className="mt-2 text-xl font-semibold">让每一次创作，心中有数</h2><p className="mt-2 text-sm text-slate-500">查看账户权益，管理你的个人资料。</p></div>
            {billingEnabled && <><section className="relative overflow-hidden rounded-2xl bg-slate-950 p-6 text-white sm:p-8"><div className="pointer-events-none absolute -right-12 -top-24 h-64 w-64 rounded-full bg-cyan-500/15 blur-3xl" /><div className="relative flex flex-wrap items-center justify-between gap-5"><div><p className="text-xs tracking-widest text-cyan-300">OPENTALKING VIP</p><h3 className="mt-3 text-2xl font-semibold">{entitlements?.vip ? '你的月度创作权益已开启' : '开启你的月度创作计划'}</h3><p className="mt-3 text-sm leading-6 text-slate-400">{entitlements?.vip_until ? `会员有效至 ${new Date(entitlements.vip_until * 1000).toLocaleString('zh-CN')}` : '30 天会员，按套餐享有对话与视频时长。'}</p></div><button onClick={() => setTab('membership')} className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300">{entitlements?.vip ? '查看权益与续费 →' : '了解月度 VIP →'}</button></div></section>
              {billingError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{billingError}<button className="ml-3 underline" onClick={() => void onRefreshBilling()}>重试</button></p>}
              {entitlements ? <QuotaSummary account={entitlements} /> : !billingError && <p role="status" className="text-sm text-slate-500">正在读取会员与额度…</p>}
              {entitlements?.active && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{entitlements.active.unlimited ? '当前有任务进行中，VIP 不扣减总使用额度。返回工作台可继续操作。' : '当前有任务进行中，已预留部分额度。返回工作台可继续操作，结束后自动结算。'}</p>}
            </>}
            <section className="rounded-2xl border border-slate-200 bg-white p-6"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">账户信息</h3><button onClick={() => setTab('profile')} className="text-xs font-medium text-cyan-700">编辑个人资料 →</button></div><dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-400">绑定手机号</dt><dd className="mt-2">{account.phone ? `${account.phone.slice(0, 3)} **** ${account.phone.slice(-4)}` : '未绑定'}</dd></div><div><dt className="text-xs text-slate-400">注册时间</dt><dd className="mt-2">{profile?.created_at ? new Date(profile.created_at * 1000).toLocaleDateString('zh-CN') : '—'}</dd></div></dl></section>
            {billingEnabled && <div className="grid gap-3 sm:grid-cols-2">{(['orders', 'usage'] as const).map(id => <button key={id} onClick={() => setTab(id)} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left"><div><p className="text-sm font-semibold">{id === 'orders' ? '订单记录' : '使用记录'}</p><p className="mt-2 text-xs text-slate-400">{id === 'orders' ? '购买与到账进度' : '任务扣减与时长退回'}</p></div><span className="text-slate-400">→</span></button>)}</div>}
          </div>}
          {(tab === 'membership' || tab === 'orders' || tab === 'usage') && <MembershipContent key={tab} section={tab} account={entitlements} error={billingError} onRefresh={onRefreshBilling} />}
          {tab === 'profile' && (profile ? <ProfileEditor profile={profile} onChange={onProfileChange} /> : !profileError && <p role="status">正在读取个人资料…</p>)}
          {tab === 'security' && <PasswordEditor />}
        </main>
      </div>
    </div>
  </div>;
}
