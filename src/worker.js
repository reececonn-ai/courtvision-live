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


function sydneyDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce((o, p) => (o[p.type] = p.value, o), {});
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function parseNbaStandingsForHistory(data) {
  const records = {};
  const entries = [];
  const walk = value => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (value.team && Array.isArray(value.stats)) entries.push(value);
    if (Array.isArray(value.children)) value.children.forEach(walk);
    if (value.standings) walk(value.standings);
    if (Array.isArray(value.entries)) value.entries.forEach(walk);
  };
  walk(data);

  const statValue = (entry, keys) => {
    for (const key of keys) {
      const stat = entry.stats.find(s => {
        const label = String(s.name || s.abbreviation || s.displayName || "").toLowerCase();
        return label === key || label.includes(key);
      });
      const n = Number(stat?.value ?? stat?.displayValue);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  for (const entry of entries) {
    const name = String(entry.team?.displayName || entry.team?.name || "").trim();
    if (!ALL_TEAMS.includes(name)) continue;
    let wins = statValue(entry, ["wins", "win"]);
    let losses = statValue(entry, ["losses", "loss"]);
    const rank = statValue(entry, ["playoffseed", "rank", "seed"]);
    if (wins == null || losses == null) {
      const summary = String(entry.note?.description || entry.summary || entry.records?.[0]?.summary || "");
      const m = summary.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (m) { wins = Number(m[1]); losses = Number(m[2]); }
    }
    if (Number.isFinite(wins) && Number.isFinite(losses)) {
      records[name] = { w: wins, l: losses, rank: Number.isFinite(rank) ? rank : null };
    }
  }
  return records;
}

function mergeDailySnapshot(list, snapshot, max = 220) {
  const next = Array.isArray(list) ? [...list] : [];
  const key = String(snapshot?.key || "");
  if (!key) return next.slice(-max);
  const i = next.findIndex(x => String(x?.key || "") === key && !!x.demo === !!snapshot.demo);
  if (i >= 0) {
    const prevAt = Date.parse(next[i]?.at || 0) || 0;
    const newAt = Date.parse(snapshot.at || 0) || 0;
    if (newAt >= prevAt) next[i] = snapshot;
  } else {
    next.push(snapshot);
  }
  return next
    .filter(Boolean)
    .sort((a, b) => String(a.key || "").localeCompare(String(b.key || "")))
    .slice(-max);
}

async function cachedNbaResponse(request, upstreamUrl, ttl, ctx, bypass = false) {
  const cache = caches.default;
  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.delete("fresh");
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  if (!bypass) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set("x-courtvision-cache", "HIT");
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
    }
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

  async ensureSeasonAlarm() {
    const existing = await this.ctx.storage.getAlarm();
    if (existing == null) {
      await this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
    }
  }

  async captureSeasonStandings() {
    const upstream = await fetch("https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=2027", {
      headers: { "accept": "application/json" },
    });
    if (!upstream.ok) throw new Error("Standings HTTP " + upstream.status);
    const data = await upstream.json();
    const records = parseNbaStandingsForHistory(data);
    if (Object.keys(records).length < 24) throw new Error("Incomplete standings snapshot");
    const snapshot = {
      key: sydneyDateKey(),
      at: new Date().toISOString(),
      demo: false,
      records,
    };
    const history = await this.ctx.storage.get("competitionRawHistory");
    const merged = mergeDailySnapshot(history, snapshot);
    await this.ctx.storage.put("competitionRawHistory", merged);
    return snapshot;
  }

  async alarm() {
    try {
      await this.captureSeasonStandings();
    } catch (error) {
      console.warn("CourtVision season snapshot failed", error);
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + 6 * 60 * 60 * 1000);
    }
  }

  async state(room) {
    await this.ensureSeasonAlarm();
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

    if (url.pathname.endsWith("/competition-history")) {
      await this.ensureSeasonAlarm();

      if (request.method === "GET") {
        const [rich, raw, alarmAt] = await Promise.all([
          this.ctx.storage.get("competitionHistory"),
          this.ctx.storage.get("competitionRawHistory"),
          this.ctx.storage.getAlarm(),
        ]);
        return json({
          ok: true,
          rich: Array.isArray(rich) ? rich : [],
          raw: Array.isArray(raw) ? raw : [],
          alarmAt: alarmAt || null,
        });
      }

      if (request.method === "POST") {
        let body;
        try { body = await request.json(); }
        catch (_) { return json({ ok: false, error: "Invalid JSON" }, 400); }

        const snapshot = body?.snapshot;
        if (!snapshot || typeof snapshot !== "object" || !snapshot.key || !Array.isArray(snapshot.rows)) {
          return json({ ok: false, error: "Expected a competition snapshot" }, 400);
        }
        if (snapshot.demo) return json({ ok: true, ignored: "demo" });

        const clean = {
          key: String(snapshot.key).slice(0, 10),
          at: String(snapshot.at || new Date().toISOString()),
          demo: false,
          rows: snapshot.rows.slice(0, 12).map(r => ({
            name: String(r.name || "").slice(0, 80),
            rank: Number(r.rank) || null,
            w: Number(r.w) || 0,
            l: Number(r.l) || 0,
            projected: Number(r.projected) || 0,
            probability: Number(r.probability) || 0,
          })),
        };

        const current = await this.ctx.storage.get("competitionHistory");
        const merged = mergeDailySnapshot(current, clean);
        await this.ctx.storage.put("competitionHistory", merged);
        return json({ ok: true, count: merged.length });
      }

      return json({ ok: false, error: "Method not allowed" }, 405);
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
        seasonMemory: true,
        seasonSnapshotEveryHours: 6,
      });
    }

    // Optional editorial feed: one upstream source, cached 3 hours at the edge.
    // Never touches the draft Durable Object or triggers scheduled background work.
    if (url.pathname === "/api/nba/news") {
      const key = new Request(url.origin + "/api/nba/news", { method: "GET" });
      const cache = caches.default;
      const hit = await cache.match(key);
      if (hit) return hit;
      try {
        const upstream = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=20", {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(5500),
        });
        if (!upstream.ok) throw new Error("ESPN news unavailable");
        const data = await upstream.json();
        const articles = (Array.isArray(data?.articles) ? data.articles : []).slice(0, 20).map(a => ({
          headline: String(a.headline || "").slice(0, 180),
          summary: String(a.description || a.story || "").replace(/<[^>]*>/g, "").slice(0, 260),
          published: String(a.published || a.lastModified || ""),
          url: String(a.links?.web?.href || a.links?.mobile?.href || ""),
          category: /injur|out for|questionable|doubtful|ruled out|surgery|availability/i.test(a.headline || "") ? "INJURY" :
            /trad|sign|waiv|acquir|deal|contract/i.test(a.headline || "") ? "ROSTER" : "NBA NEWS",
        })).filter(a => a.headline && /^https:\/\/(www\.)?espn\.com\//.test(a.url));
        const response = json({ ok: true, source: "ESPN", fetchedAt: new Date().toISOString(), articles });
        response.headers.set("cache-control", "public, max-age=10800, s-maxage=10800");
        ctx.waitUntil(cache.put(key, response.clone()));
        return response;
      } catch (_) {
        // Cache failures temporarily too: do not hammer upstream on every viewer.
        const response = json({ ok: false, articles: [], error: "News temporarily unavailable" });
        response.headers.set("cache-control", "public, max-age=1800, s-maxage=1800");
        ctx.waitUntil(cache.put(key, response.clone()));
        return response;
      }
    }

    if (url.pathname === "/api/nba/standings") {
      const season = String(url.searchParams.get("season") || "2027");
      if (!/^\d{4}$/.test(season)) return json({ ok: false, error: "Invalid season" }, 400);
      const upstream = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=" + encodeURIComponent(season);
      const bypass = url.searchParams.get("fresh") === "1";
      return cachedNbaResponse(request, upstream, nbaCacheTtl("standings", season), ctx, bypass);
    }

    if (url.pathname === "/api/nba/team-detail") {
      if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      const team = String(url.searchParams.get("team") || "").toLowerCase();
      const kind = String(url.searchParams.get("kind") || "");
      if (!/^[a-z0-9]{2,4}$/.test(team) || !["roster", "schedule", "injuries"].includes(kind)) return json({ ok: false, error: "Invalid team detail request" }, 400);
      const upstream = kind === "injuries" ? "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries" : "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/" + encodeURIComponent(team) + "/" + kind + "?season=2027";
      return cachedNbaResponse(request, upstream, 120, ctx);
    }

    if (url.pathname === "/api/nba/summary") {
      if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      const event = String(url.searchParams.get("event") || "");
      if (!/^\d{1,15}$/.test(event)) return json({ ok: false, error: "Invalid event" }, 400);
      const upstream = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=" + encodeURIComponent(event);
      return cachedNbaResponse(request, upstream, 60, ctx);
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