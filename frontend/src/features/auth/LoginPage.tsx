import { useEffect, useState, type FormEvent } from "react";
import { type Account, loginAsAdmin, loginByPassword, registerByPhone, sendLoginCode } from "./api";

export function LoginPage({ admin, smsReady, onLogin }: {
  admin: boolean; smsReady: boolean; onLogin: (account: Account) => void;
}) {
  const [phone, setPhone] = useState("");
  const [loginMode, setLoginMode] = useState<"password" | "phone">("phone");
  const passwordMode = admin || loginMode === "password";
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  const validPhone = /^1[3-9]\d{9}$/.test(phone);

  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  async function sendCode() {
    if (!validPhone || sending || remaining) return;
    setSending(true); setError(""); setNotice("");
    try {
      const result = await sendLoginCode(phone);
      const current = Date.now();
      setNow(current); setDeadline(current + result.retry_after * 1000);
      setNotice("验证码发送请求已提交，请注意查收，5 分钟内有效。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "验证码发送失败，请稍后重试。");
    } finally { setSending(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!passwordMode && password !== confirmPassword) {
      setError("两次输入的密码不一致，请重新确认。");
      return;
    }
    setBusy(true); setError("");
    try {
      const result = admin ? await loginAsAdmin(username.trim(), password) : passwordMode ? await loginByPassword(phone, password) : await registerByPhone(phone, code, password);
      onLogin(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败，请稍后重试。");
    } finally { setBusy(false); }
  }

  const inputClass = "mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 disabled:bg-slate-50";
  return (
    <main className="min-h-screen bg-[#f5f7fa] text-slate-900 lg:grid lg:grid-cols-[1.05fr_1fr]">
      <section className="relative overflow-hidden bg-slate-950 px-7 py-9 text-white sm:px-12 lg:flex lg:min-h-screen lg:flex-col lg:px-16 lg:py-12">
        <a href="/" className="relative z-10 inline-flex items-center gap-3 text-lg font-semibold tracking-tight">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-300 text-slate-950" aria-hidden="true">✦</span>
          OpenTalking<span className="ml-1 text-xs font-normal text-slate-400">STUDIO</span>
        </a>
        <div className="pointer-events-none absolute -left-40 top-48 h-[32rem] w-[32rem] rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative z-10 my-auto max-w-lg py-10 lg:py-20">
          <div className="mb-6 inline-flex items-center gap-2 text-xs font-medium tracking-[0.18em] text-cyan-300"><span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />{admin ? "WORKSPACE MANAGEMENT" : "YOUR DIGITAL HUMAN STUDIO"}</div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">{admin ? <>让每一次创作，<br /><span className="text-cyan-300">有序发生。</span></> : <>让你的表达，<br /><span className="text-cyan-300">拥有新的形象。</span></>}</h1>
          <p className="mt-6 max-w-sm text-sm leading-7 text-slate-400">{admin ? "在独立管理后台查看用户概况、管理服务配置，掌握工作台的运行情况。" : "从一段对话到一支视频，在一个工作台里完成数字人实时互动与内容创作。"}</p>
          <div className="mt-10 hidden gap-3 sm:flex" aria-label="工作台能力">{["实时数字人", "视频创作", "个人作品库"].map((label) => <span key={label} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">{label}</span>)}</div>
        </div>
        <p className="relative z-10 hidden text-xs text-slate-500 lg:block">OpenTalking · 每一个想法，都可以被看见。</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          <div className="mb-9"><p className="mb-3 text-xs font-semibold tracking-widest text-cyan-700">{admin ? "管理后台" : "欢迎来到 OPENTALKING"}</p><h2 className="text-3xl font-semibold tracking-tight">{admin ? "管理员登录" : passwordMode ? "欢迎回来" : "注册，开始创作"}</h2><p className="mt-3 text-sm leading-6 text-slate-500">{admin ? "使用预设的管理员账号进入后台。" : passwordMode ? "使用注册手机号和密码，登录创作工作台。" : "验证手机号并设置密码，之后可直接使用密码登录。"}</p></div>
          <form onSubmit={(event) => void submit(event)} className="space-y-5">
            {admin ? <label className="block text-sm font-medium">管理员账号<input autoComplete="username" name="username" required maxLength={80} value={username} onChange={(e) => setUsername(e.target.value)} className={inputClass} placeholder="输入管理员账号" disabled={busy} /></label> :
              <label className="block text-sm font-medium">手机号<div className="relative"><span className="absolute left-4 top-1/2 mt-1 -translate-y-1/2 border-r border-slate-200 pr-3 text-sm text-slate-500">+86</span><input type="tel" name="phone" aria-label="手机号" autoComplete="tel-national" inputMode="numeric" required pattern="1[3-9][0-9]{9}" maxLength={11} value={phone} onChange={(e) => { setPhone(e.target.value.replace(/\D/g, "")); setCode(""); setNotice(""); }} className={`${inputClass} pl-20`} placeholder="输入手机号码" disabled={busy || sending} /></div></label>
            }
            {!passwordMode && <>
              <label className="block text-sm font-medium">短信验证码<div className="flex items-center gap-3"><input name="code" aria-label="短信验证码" autoComplete="one-time-code" inputMode="numeric" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={`${inputClass} min-w-0 flex-1 tracking-[0.2em]`} placeholder="6 位验证码" disabled={busy} /><button type="button" onClick={() => void sendCode()} disabled={!validPhone || !smsReady || sending || busy || remaining > 0} className="mt-2 h-12 shrink-0 rounded-xl border border-cyan-200 bg-cyan-50 px-3 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400">{sending ? "发送中…" : remaining ? `${remaining}s 后重发` : "获取验证码"}</button></div></label>
              {!smsReady && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-800">短信服务暂不可用，已注册用户可使用账号密码登录。</p>}
            </>}
            <label className="block text-sm font-medium">{passwordMode ? "密码" : "设置密码"}<input type="password" name="password" autoComplete={passwordMode ? "current-password" : "new-password"} required minLength={passwordMode ? undefined : 6} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder={passwordMode ? "输入登录密码" : "设置 6～128 位登录密码"} disabled={busy} /></label>
            {!passwordMode && <label className="block text-sm font-medium">确认密码<input type="password" name="confirmPassword" autoComplete="new-password" required minLength={6} maxLength={128} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputClass} placeholder="再次输入登录密码" disabled={busy} /></label>}
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {notice && <p role="status" className="text-xs text-emerald-700">{notice}</p>}
            <button type="submit" disabled={busy || (admin ? !username.trim() || !password : !validPhone || !password || (!passwordMode && (code.length !== 6 || !smsReady || password.length < 6 || !confirmPassword)))} className="w-full rounded-xl bg-slate-950 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-cyan-900 disabled:cursor-not-allowed disabled:bg-slate-300">{busy ? (passwordMode ? "正在登录…" : "正在注册…") : admin ? "进入管理后台" : passwordMode ? "登录工作台" : "注册并登录"}<span aria-hidden="true" className="ml-3">→</span></button>
          </form>
          {!admin && <p className="mt-6 text-center text-sm text-slate-500">{passwordMode ? "还没有账号？" : "已注册？"}<button type="button" disabled={busy || sending} onClick={() => { setLoginMode(passwordMode ? "phone" : "password"); setPassword(""); setConfirmPassword(""); setError(""); setNotice(""); }} className="ml-2 font-medium text-cyan-700 hover:underline disabled:opacity-50">{passwordMode ? "手机号注册" : "账号密码登录"}</button></p>}
          <div className={`mt-8 text-center text-xs leading-6 text-slate-500 ${admin ? "border-t border-slate-200 pt-6" : ""}`}>{admin ? <>管理员账号由平台预设，不开放注册。<br /><a href="/" className="font-medium text-cyan-700 hover:underline">返回用户工作台</a></> : "你的作品与专属声音将保存在个人账号中。"}</div>
        </div>
      </section>
    </main>
  );
}
