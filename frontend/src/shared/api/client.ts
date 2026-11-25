export const API_BASE = import.meta.env?.VITE_API_BASE ?? "/api";

let displayedAccount: number | null = null;
export function setApiAccount(id: number | null): void { displayedAccount = id; }

export function getApiPortal(): "admin" | "user" {
  return typeof window !== "undefined" && /^\/admin(?:\/|$)/.test(window.location.pathname) ? "admin" : "user";
}

function sessionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("X-Opentalking-Portal", getApiPortal());
  if (displayedAccount !== null && !headers.has("X-Opentalking-Account")) headers.set("X-Opentalking-Account", String(displayedAccount));
  return fetch(input, { credentials: "include", ...init, headers });
}

export function buildApiUrl(path: string): string {
  const p = path.startsWith("/") ? path.slice(1) : path;
  return new URL(p, normalizedApiBase()).toString();
}

export function buildApiDownloadUrl(path: string): string {
  return buildApiUrl(path);
}

/** WebSocket：相对 ``/api`` 走当前页 host；绝对 ``VITE_API_BASE`` 时与 HTTP 同机（与主仓一致） */
export function buildWsUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") {
    const apiBase = (API_BASE.endsWith("/") ? API_BASE.slice(0, -1) : API_BASE).replace(/^\//, "");
    return `ws://127.0.0.1:5173/${apiBase}${p}`;
  }
  try {
    const baseUrl = new URL(normalizedApiBase());
    const wsProto = baseUrl.protocol === "https:" ? "wss:" : "ws:";
    const pathname = baseUrl.pathname.endsWith("/") ? baseUrl.pathname.slice(0, -1) : baseUrl.pathname;
    return `${wsProto}//${baseUrl.host}${pathname}${p}`;
  } catch {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const apiBase = API_BASE.endsWith("/") ? API_BASE.slice(0, -1) : API_BASE;
    return `${proto}//${window.location.host}/${apiBase}${p}`;
  }
}

function normalizedApiBase(): URL {
  const base = API_BASE.endsWith("/") ? API_BASE : `${API_BASE}/`;
  if (typeof window === "undefined") {
    return new URL(base, "http://127.0.0.1:5173/");
  }
  return new URL(base, window.location.href);
}

/** Rich error type so callers can show the FastAPI {"detail": "..."} message. */
export class ApiError extends Error {
  status: number;
  detail: string | null;
  body: string;
  constructor(status: number, detail: string | null, body: string) {
    super(detail || `HTTP ${status}: ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.body = body;
  }
}

async function throwIfNotOk(r: Response): Promise<void> {
  if (r.ok) return;
  if (r.status === 402 && typeof window !== 'undefined') window.dispatchEvent(new Event('opentalking:quota-required'));
  if (r.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event("opentalking:unauthorized"));
  }
  const body = await r.text();
  let detail: string | null = null;
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.detail === "string") {
      detail = parsed.detail;
    } else if (Array.isArray(parsed?.detail)) {
      // FastAPI validation errors arrive as a list of {loc, msg, ...}
      detail = parsed.detail
        .map((d: { msg?: string }) => d?.msg ?? JSON.stringify(d))
        .join("; ");
    } else if (parsed?.detail != null) {
      detail = JSON.stringify(parsed.detail);
    }
  } catch {
    // body wasn't JSON; leave detail null
  }
  throw new ApiError(r.status, detail, body);
}

export async function apiGet<T>(path: string): Promise<T> {
  const r = await sessionFetch(buildApiUrl(path));
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

/**
 * API helpers for endpoints that carry a short-lived bearer token.
 * Studio requests use session cookies; optional streaming control headers
 * share the same response/error handling.
 */
export async function apiGetWithHeaders<T>(path: string, headers: Record<string, string>): Promise<T> {
  const r = await sessionFetch(buildApiUrl(path), { headers });
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const r = await sessionFetch(buildApiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

export async function apiPostWithHeaders<T>(
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<T> {
  const r = await sessionFetch(buildApiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

export async function apiPut<T, B = unknown>(path: string, body?: B): Promise<T> {
  const r = await sessionFetch(buildApiUrl(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

export async function apiPostBlob(path: string, body?: unknown): Promise<Blob> {
  const r = await sessionFetch(buildApiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await throwIfNotOk(r);
  return r.blob();
}

export async function apiPostFormBlob(path: string, form: FormData, init?: RequestInit): Promise<Blob> {
  const r = await sessionFetch(buildApiUrl(path), { method: "POST", body: form, ...init });
  await throwIfNotOk(r);
  return r.blob();
}

/** multipart/form-data（语音识别 speak_audio / transcribe） */
export async function apiPostForm<T>(path: string, form: FormData, init?: RequestInit): Promise<T> {
  const r = await sessionFetch(buildApiUrl(path), { method: "POST", body: form, ...init });
  await throwIfNotOk(r);
  return r.json() as Promise<T>;
}

export async function apiUploadFile<T>(path: string, fieldName: string, file: File): Promise<T> {
  const form = new FormData();
  form.set(fieldName, file);
  return apiPostForm<T>(path, form);
}

export async function apiDelete<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await sessionFetch(buildApiUrl(path), { ...init, method: "DELETE" });
  await throwIfNotOk(r);
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}

export async function apiDeleteWithHeaders<T>(path: string, headers: Record<string, string>): Promise<T> {
  const r = await sessionFetch(buildApiUrl(path), { method: "DELETE", headers });
  await throwIfNotOk(r);
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}
