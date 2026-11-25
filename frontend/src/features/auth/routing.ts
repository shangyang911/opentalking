import type { Account } from "./api";

type AuthScreen = "userLogin" | "adminLogin" | "studio" | "admin" | "adminDisabled";

export function selectAuthScreen(pathname: string, enabled: boolean, role?: Account["role"]): AuthScreen {
  if (/^\/admin(?:\/|$)/.test(pathname)) {
    if (!enabled) return "adminDisabled";
    return role === "admin" ? "admin" : "adminLogin";
  }
  // An explicit login URL must remain a login page, including with an admin cookie.
  if (/^\/login\/?$/.test(pathname)) return "userLogin";
  if (!enabled || role === "user") return "studio";
  return "userLogin";
}
