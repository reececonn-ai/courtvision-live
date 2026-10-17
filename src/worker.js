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
  return /^[a-z0-9][a-z0-9-]{5,39}$/.test(name);
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

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

async function pinDigest(pin, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const saltBytes = Uint8Array.from(atob(salt), c => c.charCodeAt(0));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 120000 },
    material,
    256
  );
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, "0")).join("");
}

export class DraftRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.stateCache = null;
  }

  async state(room = "draft") {
    if (this.stateCache) return this.stateCache;
    const stored = await this.ctx.storage.get("state");
    this.stateCache = stored || defaultState(room);
    return this.stateCache;
  }

  async authInfo() {
    return (await this.ctx.storage.get("commissionerAuth")) || null;
  }

  async claimOrVerify(pin) {
    const supplied = String(pin || "");
    if (supplied.length < 6) {
      return { ok: false, status: 400, error: "Commissioner PIN must be at least 6 characters." };
    }

    const auth = await this.authInfo();

    // Optional recovery path if a legacy Cloudflare CONTROL_PIN secret already exists.
    if (this.env.CONTROL_PIN && supplied === this.env.CONTROL_PIN) {
      return { ok: true, claimedNow: false, recovery: true };
    }

    if (!auth) {
      const salt = randomSalt();
      const digest = await pinDigest(supplied, salt);
      await this.ctx.storage.put("commissionerAuth", {
        salt,
        digest,
        createdAt: new Date().toISOString(),
      });
      return { ok: true, claimedNow: true };
    }

    const digest = await pinDigest(supplied, auth.salt);
    if (digest !== auth.digest) {
      return { ok: false, status: 401, error: "Incorrect commissioner PIN." };
    }
    return { ok: true, claimedNow: false };
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
    const room = request.headers.get("x-courtvision-room") || "draft";

    if (url.pathname.endsWith("/socket")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      const current = await this.state(room);
      server.send(JSON.stringify({ type: "state", state: current }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "GET") {
      const auth = await this.authInfo();
      return json({ ok: true, claimed: Boolean(auth), state: await this.state(room) });
    }

    if (request.method === "PUT") {
      const supplied = request.headers.get("x-control-pin") || "";
      const auth = await this.claimOrVerify(supplied);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

      let body;
      try { body = await request.json(); }
      catch (_) { return json({ ok: false, error: "Invalid JSON" }, 400); }

      if (!body || typeof body.state !== "object" || Array.isArray(body.state)) {
        return json({ ok: false, error: "Expected { state: {...} }" }, 400);
      }

      const current = await this.state(room);
      const next = { ...current, ...body.state, room };
      return json({
        ok: true,
        claimed: true,
        claimedNow: Boolean(auth.claimedNow),
        state: await this.save(next),
      });
    }

    if (request.method === "POST" && url.pathname.endsWith("/reset")) {
      const supplied = request.headers.get("x-control-pin") || "";
      const auth = await this.claimOrVerify(supplied);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

      const fresh = defaultState(room);
      fresh.version = 0;
      return json({ ok: true, claimed: true, state: await this.save(fresh) });
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  async webSocketMessage(socket, message) {
    if (message === "ping") {
      try { socket.send("pong"); } catch (_) {}
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
