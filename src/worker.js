const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

const ALL_TEAMS = [
  "Atlanta Hawks","Boston Celtics","Brooklyn Nets","Charlotte Hornets","Chicago Bulls","Cleveland Cavaliers",
  "Dallas Mavericks","Denver Nuggets","Detroit Pistons","Golden State Warriors","Houston Rockets","Indiana Pacers",
  "LA Clippers","Los Angeles Lakers","Memphis Grizzlies","Miami Heat","Milwaukee Bucks","Minnesota Timberwolves",
  "New Orleans Pelicans","New York Knicks","Oklahoma City Thunder","Orlando Magic","Philadelphia 76ers","Phoenix Suns",
  "Portland Trail Blazers","Sacramento Kings","San Antonio Spurs","Toronto Raptors","Utah Jazz","Washington Wizards"
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, "cache-control": "no-store" },
  });
}

function roomNameFromUrl(url) {
  const match = url.pathname.match(/^\/(?:api|ws)\/rooms\/([^/]+)/);
  return match ? decodeURIComponent(match[1]).trim().toLowerCase() : "";
}

function validRoomName(name) {
  return /^[a-z0-9][a-z0-9-]{5,39}$/.test(name);
}


function nbaCacheTtl(kind, value) {
  if (kind === "standings") return 300;
  if (kind === "scoreboard") {
    const m = String(value || "").match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return 90;
    const requested = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const ageDays = Math.floor((Date.now() - requested) / 86400000);
    return ageDays >= 2 ? 86400 : 90;
  }
  return 120;
}

async function cachedNbaResponse(request, upstreamUrl, ttl, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set("x-courtvision-cache", "HIT");
    return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
  }

  const upstream = await fetch(upstreamUrl, {
    headers: { "accept": "application/json" },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!upstream.ok) {
    return json({ ok: false, error: "NBA upstream unavailable", status: upstream.status }, 502);
  }

  const body = await upstream.text();
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": `public, max-age=${ttl}`,
    "x-courtvision-cache": "MISS",
    "x-courtvision-upstream-fetched-at": new Date().toISOString(),
  });
  const response = new Response(body, { status: 200, headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function defaultState(room) {
  return {
    version: 1,
    room,
    updatedAt: new Date().toISOString(),
    screen: "wheel",
    phase: "main",
    startingBudget: 50,
    teamCap: 5,
    currentTeam: null,
    currentBid: null,
    wheel: { spinning: false, targetTeam: null, selectedTeam: null, spinId: null },
    players: Array.from({ length: 6 }, (_, i) => ({
      name: `Player ${i + 1}`,
      remaining: 50,
      teams: [],
    })),
    assignments: {},
    passed: [],
    available: [...ALL_TEAMS],
    history: [],
    message: "",
  };
}

export class DraftRoom {
  constructor(ctx) {
    this.ctx = ctx;
    this.stateCache = null;
  }

  async state(room) {
    if (this.stateCache) return this.stateCache;
    const stored = await this.ctx.storage.get("state");
    const fresh = defaultState(room);

    if (!stored) {
      this.stateCache = fresh;
      return fresh;
    }

    const hasActivity =
      Object.keys(stored.assignments || {}).length > 0 ||
      (stored.passed || []).length > 0 ||
      (stored.history || []).length > 0;

    this.stateCache = {
      ...fresh,
      ...stored,
      players: Array.isArray(stored.players) && stored.players.length ? stored.players : fresh.players,
      assignments: stored.assignments || {},
      passed: Array.isArray(stored.passed) ? stored.passed : [],
      history: Array.isArray(stored.history) ? stored.history : [],
      available:
        Array.isArray(stored.available) && (stored.available.length || hasActivity)
          ? stored.available
          : fresh.available,
    };

    if (!this.stateCache.screen || this.stateCache.screen === "lobby") {
      this.stateCache.screen = "wheel";
    }

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
    const payload = JSON.stringify({ type: "state", state: normalized });
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(payload); } catch (_) {}
    }
    return normalized;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const room = request.headers.get("x-courtvision-room") || "draft-public";

    if (url.pathname.endsWith("/socket")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: "state", state: await this.state(room) }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "GET") {
      return json({ ok: true, state: await this.state(room) });
    }

    if (request.method === "PUT") {
      let body;
      try { body = await request.json(); }
      catch (_) { return json({ ok: false, error: "Invalid JSON" }, 400); }

      if (!body || typeof body.state !== "object" || Array.isArray(body.state)) {
        return json({ ok: false, error: "Expected { state: {...} }" }, 400);
      }

      const current = await this.state(room);
      return json({ ok: true, state: await this.save({ ...current, ...body.state, room }) });
    }

    if (request.method === "POST" && url.pathname.endsWith("/reset")) {
      const fresh = defaultState(room);
      fresh.version = 0;
      return json({ ok: true, state: await this.save(fresh) });
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  async webSocketMessage(socket, message) {
    if (message === "ping") {
      try { socket.send("pong"); } catch (_) {}
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "courtvision-live",
        now: new Date().toISOString(),
        nbaProxy: true,
        nbaCacheSeconds: { standings: 300, liveScoreboard: 90, historicalScoreboard: 86400 },
      });
    }

    if (url.pathname === "/api/nba/standings") {
      const season = String(url.searchParams.get("season") || "2027");
      if (!/^\d{4}$/.test(season)) return json({ ok: false, error: "Invalid season" }, 400);
      const upstream = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=" + encodeURIComponent(season);
      return cachedNbaResponse(request, upstream, nbaCacheTtl("standings", season), ctx);
    }

    if (url.pathname === "/api/nba/scoreboard") {
      const dates = String(url.searchParams.get("dates") || "");
      if (!/^\d{8}$/.test(dates)) return json({ ok: false, error: "Invalid dates" }, 400);
      const upstream = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=" + encodeURIComponent(dates);
      return cachedNbaResponse(request, upstream, nbaCacheTtl("scoreboard", dates), ctx);
    }

    if (url.pathname === "/draft" || url.pathname === "/friends") {
      return Response.redirect(new URL("/?room=draft-4e6u6d5p46", url), 302);
    }

    if (url.pathname.startsWith("/api/rooms/") || url.pathname.startsWith("/ws/rooms/")) {
      const room = roomNameFromUrl(url);
      if (!validRoomName(room)) return json({ ok: false, error: "Invalid room name" }, 400);

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