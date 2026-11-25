import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError, getApiPortal, setApiAccount } from "../../shared/api/client";
import { type Account, type AuthStatus, loadAccount, loadAuthStatus, logoutAccount } from "./api";
import { LoginPage } from "./LoginPage";
import { AdminWorkspace } from "../admin/AdminWorkspace";
import { selectAuthScreen } from "./routing";

const SESSION_CHANGE_KEY = `opentalking-auth-session-change:${getApiPortal()}`;
function announceSessionChange(): void {
  try { window.localStorage.setItem(SESSION_CHANGE_KEY, `${Date.now()}:${Math.random()}`); }
  catch { /* Focus validation also catches account changes when storage is unavailable. */ }
}

export function AuthBoundary({ children }: { children: (account: Account | null, logout?: () => Promise<void>, billingEnabled?: boolean) => ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const screen = selectAuthScreen(window.location.pathname, status?.enabled ?? false, account?.role);

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    void (async () => {
      try {
        const next = await loadAuthStatus();
        if (!active) return;
        setStatus(next);
        if (next.enabled) {
          try {
            const result = await loadAccount();
            if (active) { setApiAccount(result.user.id); setAccount(result.user); }
          } catch (reason) {
            if (!(reason instanceof ApiError && reason.status === 401)) throw reason;
          }
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "无法连接服务，请稍后重试。");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    const expired = () => { setApiAccount(null); setAccount(null); };
    window.addEventListener("opentalking:unauthorized", expired);
    return () => window.removeEventListener("opentalking:unauthorized", expired);
  }, []);

  useEffect(() => {
    if (!status?.enabled) return;
    const changed = (event: StorageEvent) => {
      if (event.key !== SESSION_CHANGE_KEY) return;
      setApiAccount(null); setAccount(null); setLoading(true);
      setAttempt(value => value + 1);
    };
    const checkOnFocus = () => {
      void loadAccount().then(result => {
        if (result.user.id !== account?.id) {
          setApiAccount(result.user.id); setAccount(result.user);
        }
      }).catch(reason => {
        if (reason instanceof ApiError && reason.status === 401) { setApiAccount(null); setAccount(null); }
      });
    };
    window.addEventListener("storage", changed);
    window.addEventListener("focus", checkOnFocus);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener("focus", checkOnFocus); };
  }, [status?.enabled, account?.id]);

  const loggedIn = (next: Account) => {
    if (next.role === "user" && /^\/login\/?$/.test(window.location.pathname)) {
      window.history.replaceState(null, "", "/");
    }
    setApiAccount(next.id); setAccount(next); announceSessionChange();
  };

  const logout = useCallback(async () => {
    await logoutAccount();
    // Do not leave private conversation history in a shared browser after logout.
    try {
      if (account?.role === "user") {
        window.localStorage.removeItem("opentalking-chat-history");
        window.localStorage.removeItem(`opentalking-chat-history:${account.id}`);
      }
    } catch { /* Storage can be unavailable in privacy mode; session logout still completes. */ }
    setApiAccount(null); setAccount(null); announceSessionChange();
  }, [account]);

  if (loading || error) return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-8"><div className="max-w-sm text-center"><p role={error ? "alert" : "status"} className="text-sm text-slate-600">{error || "正在连接工作台…"}</p>{error && <button className="mt-5 rounded-lg bg-slate-950 px-5 py-2 text-sm text-white" onClick={() => setAttempt((value) => value + 1)}>重新连接</button>}</div></main>;
  if (screen === "adminDisabled") return <main className="p-12 text-center text-slate-600">管理后台需要启用账号认证。<a href="/" className="ml-3 text-cyan-700">返回工作台</a></main>;
  if (screen === "userLogin" || screen === "adminLogin") return <LoginPage admin={screen === "adminLogin"} smsReady={status?.sms_ready ?? false} onLogin={loggedIn} />;
  if (screen === "admin" && account) return <AdminWorkspace account={account} onLogout={logout} billingEnabled={status?.billing_enabled ?? false} />;
  if (!status?.enabled) return <>{children(null)}</>;
  return <Fragment key={account?.id}>{children(account, logout, status?.billing_enabled ?? false)}</Fragment>;
}
