const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, "cache-control": "no-store", ...extra },
  });
}

function roomNameFromUrl(url) {
  const match = url.pathname.match(/^\/(?:api|ws)\/rooms\/([^/]+)/);
  return match ? decodeURIComponent(match[1]).trim().toLowerCase() : "";
}

function validRoomName(name) {
  return /^[a-z0-9][a-z0-9-]{1,39}$/.test(name);
}

function defaultState(room) {
  return {
    version: 1,
    room,
    updatedAt: new Date().toISOString(),
    screen: "lobby",
    phase: "main",
    currentTeam: null,
    currentBid: null,
    wheel: { spinning: false, selectedTeam: null, spinId: null },
    players: [],
    assignments: {},
    passed: [],
    available: [],
    history: [],
    message: "CourtVision is ready.",
  };
}

export class DraftRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.stateCache = null;
  }

  async state() {
    if (this.stateCache) return this.stateCache;
    const stored = await this.ctx.storage.get("state");
    this.stateCache = stored || defaultState("draft");
    return this.stateCache;
  }

  async save(next) {
    const normalized = {
      ...next,
      version: Number(next.version || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    this.stateCache = normalized;
    await this.ctx.storage.put("state", normalized);
    this.broadcast({ type: "state", state: normalized });
    return normalized;
  }

  broadcast(payload) {
    const text = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(text); } catch (_) {}
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/socket")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      const current = await this.state();
      server.send(JSON.stringify({ type: "state", state: current }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "GET") {
      return json({ ok: true, state: await this.state() });
    }

    if (request.method === "PUT") {
      const supplied = request.headers.get("x-control-pin") || "";
      const required = this.env.CONTROL_PIN || "";
      if (!required || supplied !== required) {
        return json({ ok: false, error: "Unauthorized commissioner request" }, 401);
      }

      let body;
      try { body = await request.json(); }
      catch (_) { return json({ ok: false, error: "Invalid JSON" }, 400); }

      if (!body || typeof body.state !== "object" || Array.isArray(body.state)) {
        return json({ ok: false, error: "Expected { state: {...} }" }, 400);
      }

      const current = await this.state();
      const next = {
        ...current,
        ...body.state,
        room: current.room || body.state.room || "draft",
      };
      return json({ ok: true, state: await this.save(next) });
    }

    if (request.method === "POST" && url.pathname.endsWith("/reset")) {
      const supplied = request.headers.get("x-control-pin") || "";
      const required = this.env.CONTROL_PIN || "";
      if (!required || supplied !== required) {
        return json({ ok: false, error: "Unauthorized commissioner request" }, 401);
      }
      const room = (await this.state()).room || "draft";
      const fresh = defaultState(room);
      fresh.version = 0;
      return json({ ok: true, state: await this.save(fresh) });
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  async webSocketMessage(_socket, message) {
    if (message === "ping") {
      try { _socket.send("pong"); } catch (_) {}
    }
  }

  webSocketClose(socket) {
    try { socket.close(1000, "Closed"); } catch (_) {}
  }

  webSocketError(socket) {
    try { socket.close(1011, "Socket error"); } catch (_) {}
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "courtvision-live", now: new Date().toISOString() });
    }

    if (url.pathname.startsWith("/api/rooms/") || url.pathname.startsWith("/ws/rooms/")) {
      const room = roomNameFromUrl(url);
      if (!validRoomName(room)) {
        return json({ ok: false, error: "Invalid room name" }, 400);
      }
      const id = env.DRAFT_ROOM.idFromName(room);
      const stub = env.DRAFT_ROOM.get(id);
      const forwarded = new URL(request.url);
      if (forwarded.pathname.startsWith("/ws/")) {
        forwarded.pathname = forwarded.pathname.replace(/^\/ws\//, "/api/");
      }
      const headers = new Headers(request.headers);
      headers.set("x-courtvision-room", room);
      return stub.fetch(new Request(forwarded, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      }));
    }

    return env.ASSETS.fetch(request);
  },
};
