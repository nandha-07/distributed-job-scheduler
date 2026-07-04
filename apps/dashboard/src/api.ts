/**
 * Tiny typed API client. Token lives in localStorage (pragmatic choice for
 * an internal dashboard — see DD-014). Every call goes through the Vite
 * proxy, so paths start with /api and CORS never enters the picture.
 */
const BASE = "/api/v1";

let token: string | null = localStorage.getItem("token");

export function setToken(t: string | null): void {
  token = t;
  if (t) localStorage.setItem("token", t);
  else localStorage.removeItem("token");
}
export function hasToken(): boolean {
  return token !== null;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 401) {
    setToken(null); // expired/invalid — force re-login
    window.location.reload();
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}
