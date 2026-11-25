import { apiGet, apiPost } from "../../shared/api/client";

export type Account = { id: number; role: "user" | "admin"; phone: string | null; username: string | null };
export type AuthStatus = { enabled: boolean; sms_ready: boolean; billing_enabled?: boolean };
export const loadAuthStatus = () => apiGet<AuthStatus>("/auth/status");
export const loadAccount = () => apiGet<{ user: Account }>("/auth/me");
export const sendLoginCode = (phone: string) => apiPost<{ retry_after: number }>("/auth/sms", { phone });
export const registerByPhone = (phone: string, code: string, password: string) => apiPost<{ user: Account }>("/auth/login", { phone, code, password });
export const loginAsAdmin = (username: string, password: string) => apiPost<{ user: Account }>("/auth/admin/login", { username, password });
export const loginByPassword = (phone: string, password: string) => apiPost<{ user: Account }>("/auth/password/login", { phone, password });
export const logoutAccount = () => apiPost("/auth/logout");

export function accountLabel(account: Account): string {
  return account.phone ? `${account.phone.slice(0, 3)} ${"•".repeat(4)} ${account.phone.slice(-4)}` : account.username || "管理员";
}
