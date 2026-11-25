import { useEffect, useState } from 'react';
import { changePassword, profileAvatarSrc, removeAvatar, saveProfile, uploadAvatar, type Profile } from './api';
import { AvatarCropper } from './AvatarCropper';

const inputClass = 'mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100';
const buttonClass = 'rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40';

export function ProfileEditor({ profile, onChange }: { profile: Profile; onChange: (profile: Profile) => void }) {
  const [nickname, setNickname] = useState(profile.nickname);
  const [signature, setSignature] = useState(profile.signature);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setNickname(profile.nickname); setSignature(profile.signature); }, [profile.nickname, profile.signature]);
  async function act(action: () => Promise<Profile>, message: string) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { onChange(await action()); setFile(null); setNotice(message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试'); }
    finally { setBusy(false); }
  }
  const avatar = profileAvatarSrc(profile.avatar_url);
  return <section className="max-w-2xl"><h2 className="text-xl font-semibold">个人资料</h2><p className="mt-2 text-sm text-slate-500">设置自己的账户形象，让工作台更熟悉。</p>
    {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</p>}
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6"><div className="flex flex-wrap items-center gap-5"><div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cyan-50 text-2xl font-semibold text-cyan-700">{avatar ? <img src={avatar} alt="当前账户头像" className="h-full w-full object-cover" /> : (profile.nickname || '我').slice(0, 1)}</div><div><p className="text-sm font-medium">账户头像</p><p className="mt-1 text-xs leading-5 text-slate-400">JPG、PNG、WebP，最大 2 MB。用于个人资料展示。</p><div className="mt-3 flex items-center gap-4"><label className={`cursor-pointer text-sm font-medium text-cyan-700 ${busy ? 'pointer-events-none opacity-40' : ''}`}>上传头像<input aria-label="上传账户头像" type="file" disabled={busy} accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={event => { const next = event.target.files?.[0]; event.target.value = ''; setError(''); if (!next) return; if (next.size > 2 * 1024 * 1024) { setError('头像文件不能超过 2 MB。'); return; } if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type)) { setError('请选择 JPG、PNG 或 WebP 图片。'); return; } setFile(next); }} /></label>{avatar && <button disabled={busy} onClick={() => void act(removeAvatar, '头像已移除。')} className="text-xs text-slate-500 underline">移除头像</button>}</div></div></div>
      {file && <AvatarCropper key={`${file.name}:${file.lastModified}`} file={file} busy={busy} onCancel={() => setFile(null)} onSave={blob => act(() => uploadAvatar(blob), '头像已更新。')} />}
      <form className="mt-7 space-y-5" onSubmit={event => { event.preventDefault(); void act(() => saveProfile(nickname, signature), '个人资料已保存。'); }}><label className="block text-sm font-medium">昵称<input value={nickname} maxLength={30} disabled={busy} onChange={event => setNickname(event.target.value)} placeholder="给自己起个昵称" className={inputClass} /><span className="mt-1 block text-right text-xs font-normal text-slate-400">{nickname.length}/30</span></label><label className="block text-sm font-medium">个性签名<textarea rows={3} value={signature} maxLength={120} disabled={busy} onChange={event => setSignature(event.target.value)} placeholder="介绍一下自己，或记录一句喜欢的话" className={`${inputClass} resize-none`} /><span className="mt-1 block text-right text-xs font-normal text-slate-400">{signature.length}/120</span></label><button disabled={busy || !!file} className={buttonClass}>{busy ? '保存中…' : '保存资料'}</button></form>
    </div></section>;
}

export function PasswordEditor() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit() {
    if (busy) return;
    setError(''); setNotice('');
    if (next !== confirm) { setError('两次输入的新密码不一致。'); return; }
    if (current === next) { setError('新密码不能与当前密码相同。'); return; }
    setBusy(true);
    try { await changePassword(current, next); setCurrent(''); setNext(''); setConfirm(''); setNotice('密码已修改，其他登录会话已退出，当前会话保持登录。'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '密码修改失败'); }
    finally { setBusy(false); }
  }
  return <section className="max-w-xl"><h2 className="text-xl font-semibold">账户安全</h2><p className="mt-2 text-sm leading-6 text-slate-500">修改登录密码。为保护账号，修改成功后其他登录会话会失效。</p><form onSubmit={event => { event.preventDefault(); void submit(); }} className="mt-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-6">{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm leading-6 text-emerald-700">{notice}</p>}{[
    ['当前密码', current, setCurrent, 'current-password'], ['新密码', next, setNext, 'new-password'], ['确认新密码', confirm, setConfirm, 'new-password'],
  ].map(([label, value, setter, autoComplete]) => <label key={String(label)} className="block text-sm font-medium">{String(label)}<input type="password" required minLength={label === '当前密码' ? 1 : 6} maxLength={128} disabled={busy} value={String(value)} onChange={event => (setter as (value: string) => void)(event.target.value)} autoComplete={String(autoComplete)} className={inputClass} /></label>)}<p className="text-xs text-slate-400">新密码为 6～128 个字符，建议使用字母、数字与符号组合。</p><button disabled={busy} className={buttonClass}>{busy ? '修改中…' : '更新密码'}</button></form></section>;
}
