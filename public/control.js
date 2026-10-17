import { cleanRoom, getState, putState, connectRoom } from "./shared.js";

const $ = (id) => document.getElementById(id);
const refs = {
  room: $("roomInput"), pin: $("pinInput"), screen: $("screenInput"), team: $("teamInput"),
  lastWins: $("lastWinsInput"), line: $("lineInput"), bid: $("bidInput"), message: $("messageInput"),
  players: $("playersInput"), status: $("connStatus"), error: $("error"), preview: $("preview"),
  watch: $("watchLink"), publishBtn: $("publishBtn")
};

let room = cleanRoom(refs.room.value);
let stopSocket = null;
let current = null;

function numberOrNull(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function render(state) {
  current = state;
  const team = state.currentTeam || "NO TEAM SELECTED";
  const last = state.lastSeasonWins ?? "—";
  const line = state.winLine ?? "—";
  const bid = state.currentBid == null ? "" : `<div class="preview-number">$${state.currentBid}</div><div class="preview-label">CURRENT BID</div>`;
  refs.preview.innerHTML = `
    <div>
      <div class="preview-label">${String(state.screen || "lobby").toUpperCase()}</div>
      <div class="preview-team">${team}</div>
      <div class="preview-number">${last} → ${line}</div>
      <div class="preview-label">LAST WINS → THIS SEASON LINE</div>
      ${bid}
    </div>`;
}

function status(value) {
  refs.status.textContent = value.toUpperCase();
  refs.status.classList.toggle("live", value === "live");
}

async function connect() {
  room = cleanRoom(refs.room.value);
  refs.room.value = room;
  localStorage.setItem("courtvision-room", room);
  refs.watch.href = `/watch.html?room=${encodeURIComponent(room)}`;
  stopSocket?.();
  refs.error.textContent = "";

  try {
    render(await getState(room));
  } catch (error) {
    refs.error.textContent = error.message;
  }

  stopSocket = connectRoom(room, {
    onStatus: status,
    onState: render,
  });
}

function parsePlayers() {
  let players;
  try { players = JSON.parse(refs.players.value); }
  catch (_) { throw new Error("Players JSON is invalid."); }
  if (!Array.isArray(players)) throw new Error("Players must be a JSON array.");
  return players.slice(0, 12).map((p, i) => ({
    name: String(p?.name || `Player ${i + 1}`).slice(0, 40),
    remaining: Number.isFinite(Number(p?.remaining)) ? Number(p.remaining) : 0,
    teams: Array.isArray(p?.teams) ? p.teams.map(String).slice(0, 12) : [],
  }));
}

async function publish(extra = {}) {
  refs.error.textContent = "";
  const pin = refs.pin.value.trim();
  if (!pin) {
    refs.error.textContent = "Enter the commissioner PIN first.";
    return false;
  }

  let players;
  try { players = parsePlayers(); }
  catch (error) { refs.error.textContent = error.message; return false; }

  const state = {
    screen: refs.screen.value,
    currentTeam: refs.team.value.trim() || null,
    lastSeasonWins: numberOrNull(refs.lastWins.value),
    winLine: numberOrNull(refs.line.value),
    currentBid: numberOrNull(refs.bid.value),
    message: refs.message.value.trim(),
    players,
    ...extra,
  };

  try {
    refs.publishBtn.disabled = true;
    const saved = await putState(room, pin, state);
    render(saved);
    return true;
  } catch (error) {
    refs.error.textContent = error.message;
    return false;
  } finally {
    refs.publishBtn.disabled = false;
  }
}

async function demoSpin() {
  const teams = [
    ["Cleveland Cavaliers",52,47.5],["New York Knicks",53,52.5],["San Antonio Spurs",62,59.5],
    ["Oklahoma City Thunder",64,62.5],["Los Angeles Lakers",53,46.5],["Boston Celtics",56,51.5]
  ];
  const choice = teams[Math.floor(Math.random() * teams.length)];
  refs.screen.value = "wheel";
  refs.team.value = "";
  const started = await publish({ wheel: { spinning: true, selectedTeam: null, spinId: crypto.randomUUID() }, currentTeam: null });
  if (!started) return;
  setTimeout(async () => {
    refs.screen.value = "team";
    refs.team.value = choice[0];
    refs.lastWins.value = choice[1];
    refs.line.value = choice[2];
    await publish({ wheel: { spinning: false, selectedTeam: choice[0], spinId: crypto.randomUUID() } });
  }, 1800);
}

$("connectBtn").addEventListener("click", connect);
$("publishBtn").addEventListener("click", () => publish());
$("spinDemoBtn").addEventListener("click", demoSpin);
refs.room.addEventListener("change", connect);

refs.pin.value = sessionStorage.getItem("courtvision-pin") || "";
refs.pin.addEventListener("input", () => sessionStorage.setItem("courtvision-pin", refs.pin.value));
connect();
