// One way to call Rust, in the desktop window or in a browser.
// Window: Tauri's IPC. Browser: the app's web server (src-tauri/src/web.rs) over HTTP + WebSocket.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";

/** True inside the desktop window, false in a browser. */
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const TOKEN_KEY = "phonedeck.webToken";

// A link like http://host:1440/?token=abc saves the token and drops it from the address bar.
if (!inTauri) {
  const url = new URL(window.location.href);
  const t = url.searchParams.get("token");
  if (t) {
    setToken(t);
    url.searchParams.delete("token");
    window.history.replaceState(null, "", url);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: works until the tab closes.
  }
}

/** Thrown when the web server rejects the token. The app shows the token prompt. */
export class AuthError extends Error {}

/** Checks a token against the server. */
export async function checkToken(t: string): Promise<boolean> {
  const r = await fetch("/api/ping", { headers: { Authorization: `Bearer ${t}` } });
  return r.ok;
}

const authListeners = new Set<() => void>();
/** Called when a request comes back 401, so the app can ask for the token again. */
export function onAuthError(cb: () => void): () => void {
  authListeners.add(cb);
  return () => {
    authListeners.delete(cb);
  };
}

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (inTauri) return tauriInvoke<T>(cmd, args);
  const r = await fetch(`/api/cmd/${cmd}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
    body: JSON.stringify(args),
  });
  if (r.status === 401) {
    authListeners.forEach((l) => l());
    throw new AuthError("Web access token missing or wrong");
  }
  // Errors are plain strings, like Tauri's.
  if (!r.ok) throw await r.text();
  if (r.headers.get("Content-Type")?.startsWith("application/octet-stream")) return (await r.arrayBuffer()) as T;
  return (await r.json()) as T;
}

// ---------- events ----------

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;

/** One shared socket for all listeners; reconnects after a drop. */
function connect() {
  if (socket || retry || !getToken()) return;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${window.location.host}/api/events?token=${encodeURIComponent(getToken()!)}`);
  socket = ws;
  ws.onmessage = (e) => {
    try {
      const { event, payload } = JSON.parse(e.data);
      handlers.get(event)?.forEach((h) => h(payload));
    } catch {
      // Not ours; ignore.
    }
  };
  ws.onclose = () => {
    socket = null;
    if ([...handlers.values()].some((s) => s.size)) {
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, 2000);
    }
  };
}

/** Same shape as Tauri's `listen`: resolves to an unlisten function. */
export async function listen<T>(event: string, cb: (e: { payload: T }) => void): Promise<() => void> {
  if (inTauri) return tauriListen<T>(event, cb);
  const h: Handler = (payload) => cb({ payload: payload as T });
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(h);
  connect();
  return () => {
    handlers.get(event)?.delete(h);
  };
}

/** Reconnect events after the token changes. */
export function reconnectEvents() {
  socket?.close();
  socket = null;
  connect();
}

// ---------- screen mirroring ----------

let localServer: Promise<{ url: string; token: string } | null> | null = null;

/** Where the desktop window reaches the app's own web server (mirroring runs through it). */
function desktopServer() {
  localServer ??= tauriInvoke<{ enabled: boolean; localUrl: string | null; token: string }>("web_info").then(
    (i) => (i.enabled && i.localUrl ? { url: i.localUrl, token: i.token } : null),
    () => null,
  );
  return localServer;
}

/**
 * WebSocket URL for a phone's live, controllable screen, or null when web access is off.
 * `video: false` = control only (no video frames), for pages that can't decode video.
 */
export async function mirrorUrl(serial: string, maxSize: number, video = true): Promise<string | null> {
  const path = `/api/mirror/${encodeURIComponent(serial)}?max=${maxSize}${video ? "" : "&video=0"}`;
  if (inTauri) {
    const s = await desktopServer();
    if (!s) return null;
    return `${s.url.replace(/^http/, "ws")}${path}&token=${encodeURIComponent(s.token)}`;
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${path}&token=${encodeURIComponent(getToken() ?? "")}`;
}
