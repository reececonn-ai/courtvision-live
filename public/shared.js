export function cleanRoom(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function generateRoomName() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = Array.from(bytes, b => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
  return `draft-${code}`;
}

export function roomFromLocation() {
  const params = new URLSearchParams(location.search);
  const fromUrl = cleanRoom(params.get("room"));
  const saved = cleanRoom(localStorage.getItem("courtvision-room"));
  const room = fromUrl || saved || generateRoomName();
  localStorage.setItem("courtvision-room", room);
  if (!fromUrl) {
    const next = new URL(location.href);
    next.searchParams.set("room", room);
    history.replaceState(null, "", next);
  }
  return room;
}

export function apiUrl(room) {
  return `/api/rooms/${encodeURIComponent(cleanRoom(room))}`;
}

export function socketUrl(room) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws/rooms/${encodeURIComponent(cleanRoom(room))}/socket`;
}

export async function getState(room) {
  const response = await fetch(apiUrl(room), { cache: "no-store" });
  if (!response.ok) throw new Error(`State request failed (${response.status})`);
  const data = await response.json();
  return data.state;
}

export async function putState(room, state) {
  const response = await fetch(apiUrl(room), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Update failed (${response.status})`);
  return data.state;
}

export async function resetRoom(room) {
  const response = await fetch(apiUrl(room) + "/reset", { method: "POST" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Reset failed (${response.status})`);
  return data.state;
}

export function connectRoom(room, handlers = {}) {
  let ws;
  let stopped = false;
  let retry = 700;
  let lastVersion = -1;
  let syncInFlight = false;

  const deliverState = state => {
    if (!state || typeof state !== "object") return;
    const version = Number(state.version);
    if (Number.isFinite(version)) {
      if (version < lastVersion) return;
      lastVersion = Math.max(lastVersion, version);
    }
    handlers.onState?.(state);
  };

  const syncLatest = async () => {
    if (stopped || syncInFlight) return;
    syncInFlight = true;
    try {
      deliverState(await getState(room));
    } catch (_) {
      // WebSocket reconnect logic remains the primary recovery path.
    } finally {
      syncInFlight = false;
    }
  };

  const open = () => {
    if (stopped) return;
    handlers.onStatus?.("connecting");
    ws = new WebSocket(socketUrl(room));

    ws.addEventListener("open", () => {
      retry = 700;
      handlers.onStatus?.("live");
      // Catch up immediately in case this tab missed a state broadcast while
      // backgrounded, sleeping or between WebSocket connections.
      syncLatest();
    });

    ws.addEventListener("message", event => {
      if (event.data === "pong") return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "state") deliverState(data.state);
      } catch (_) {}
    });

    ws.addEventListener("close", () => {
      handlers.onStatus?.("offline");
      if (!stopped) {
        const delay = retry;
        retry = Math.min(8000, retry * 1.7);
        setTimeout(open, delay);
      }
    });

    ws.addEventListener("error", () => {
      try { ws.close(); } catch (_) {}
    });
  };

  const onVisibility = () => {
    if (!document.hidden) syncLatest();
  };
  const onFocus = () => syncLatest();

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onFocus);

  open();

  const ping = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      try { ws.send("ping"); } catch (_) {}
    }
  }, 25000);

  // Draft-night safety net: if a browser silently misses a WebSocket message,
  // a visible screen self-heals within a couple of seconds.
  const fallbackSync = setInterval(() => {
    if (!document.hidden) syncLatest();
  }, 2000);

  return () => {
    stopped = true;
    clearInterval(ping);
    clearInterval(fallbackSync);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onFocus);
    try { ws?.close(1000, "Client closed"); } catch (_) {}
  };
}