export function cleanRoom(value) {
  const room = String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return room || "nba2026";
}

export function roomFromLocation() {
  const params = new URLSearchParams(location.search);
  return cleanRoom(params.get("room") || localStorage.getItem("courtvision-room") || "nba2026");
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

export async function putState(room, pin, state) {
  const response = await fetch(apiUrl(room), {
    method: "PUT",
    headers: { "content-type": "application/json", "x-control-pin": pin },
    body: JSON.stringify({ state }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Publish failed (${response.status})`);
  return data.state;
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
