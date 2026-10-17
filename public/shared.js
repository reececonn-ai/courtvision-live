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

export function generateControlKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

export function controlKeyForRoom(room) {
  const keyName = `courtvision-control-key:${cleanRoom(room)}`;
  let key = localStorage.getItem(keyName);
  if (!key) {
    key = generateControlKey();
    localStorage.setItem(keyName, key);
  }
  return key;
}

export function roomFromLocation() {
  const params = new URLSearchParams(location.search);
  return cleanRoom(params.get("room") || localStorage.getItem("courtvision-room") || "draft-public");
}

export function apiUrl(room) {
  return `/api/rooms/${encodeURIComponent(cleanRoom(room))}`;
}

export function socketUrl(room) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws/rooms/${encodeURIComponent(cleanRoom(room))}/socket`;
}

export async function getRoomInfo(room) {
  const response = await fetch(apiUrl(room), { cache: "no-store" });
  if (!response.ok) throw new Error(`Room request failed (${response.status})`);
  return response.json();
}

export async function getState(room) {
  const data = await getRoomInfo(room);
  return data.state;
}

export async function putState(room, controlKey, state) {
  const response = await fetch(apiUrl(room), {
    method: "PUT",
    headers: { "content-type": "application/json", "x-control-key": controlKey },
    body: JSON.stringify({ state }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Publish failed (${response.status})`);
  return data;
}

export function connectRoom(room, handlers = {}) {
  let ws;
  let stopped = false;
  let retry = 700;

  const open = () => {
    if (stopped) return;
    handlers.onStatus?.("connecting");
    ws = new WebSocket(socketUrl(room));

    ws.addEventListener("open", () => {
      retry = 700;
      handlers.onStatus?.("live");
    });

    ws.addEventListener("message", (event) => {
      if (event.data === "pong") return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "state") handlers.onState?.(data.state);
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

  open();

  const ping = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      try { ws.send("ping"); } catch (_) {}
    }
  }, 25000);

  return () => {
    stopped = true;
    clearInterval(ping);
    try { ws?.close(1000, "Client closed"); } catch (_) {}
  };
}
