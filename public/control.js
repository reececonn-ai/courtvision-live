import {
  cleanRoom,
  generateRoomName,
  controlKeyForRoom,
  getRoomInfo,
  putState,
  connectRoom
} from "./shared.js";
import {
  TEAMS,
  teamByName,
  renderBroadcastStage,
  renderLocalTeamOverlay,
  renderLocalBoardOverlay
} from "./stage.js";

const $ = id => document.getElementById(id);
const refs = {
  stage: $("stage"),
  overlay: $("localOverlay"),
  status: $("connStatus"),
  drawer: $("controlDrawer"),
  scrim: $("drawerScrim"),
  controlsBtn: $("controlsBtn"),
  closeControlsBtn: $("closeControlsBtn"),
  watchUrl: $("watchUrl"),
  copyLinkBtn: $("copyLinkBtn"),
  returnEveryoneBtn: $("returnEveryoneBtn"),
  screen: $("screenInput"),
  team: $("teamInput"),
  lastWins: $("lastWinsInput"),
  line: $("lineInput"),
  bid: $("bidInput"),
  message: $("messageInput"),
  playerRows: $("playerRows"),
  publishBtn: $("publishBtn"),
  spinDemoBtn: $("spinDemoBtn"),
  error: $("error")
};

const savedRoom = cleanRoom(localStorage.getItem("courtvision-control-room"));
let room = savedRoom.length >= 6 ? savedRoom : generateRoomName();
let controlKey = controlKeyForRoom(room);
let stopSocket = null;
let currentState = null;
let lastFocusToken = null;
let syncingControls = false;

refs.team.innerHTML = `<option value="">No team selected</option>` +
  TEAMS.map(t => `<option value="${t.name}">${t.name}</option>`).join("");

refs.playerRows.innerHTML = Array.from({ length: 6 }, (_, i) => `
  <div class="player-edit-row">
    <input data-player-name="${i}" value="Player ${i + 1}" aria-label="Player ${i + 1} name">
    <input data-player-budget="${i}" value="50" inputmode="decimal" aria-label="Player ${i + 1} remaining budget">
  </div>
`).join("");

function setStatus(value) {
  refs.status.textContent = value === "live" ? "LIVE" : value.toUpperCase();
  refs.status.classList.toggle("live", value === "live");
}

function openDrawer() {
  refs.drawer.classList.add("open");
  refs.drawer.setAttribute("aria-hidden", "false");
  refs.scrim.hidden = false;
  requestAnimationFrame(() => refs.scrim.classList.add("show"));
}

function closeDrawer() {
  refs.drawer.classList.remove("open");
  refs.drawer.setAttribute("aria-hidden", "true");
  refs.scrim.classList.remove("show");
  setTimeout(() => { refs.scrim.hidden = true; }, 180);
}

function closeLocal() {
  refs.overlay.hidden = true;
  refs.overlay.innerHTML = "";
}

function openTeam(name) {
  renderLocalTeamOverlay(refs.overlay, name, closeLocal);
}

function openBoard() {
  renderLocalBoardOverlay(refs.overlay, currentState || {}, openTeam, closeLocal);
}

function render(state) {
  currentState = state;

  if (lastFocusToken !== null && state.focusToken && state.focusToken !== lastFocusToken) {
    closeLocal();
  }
  if (state.focusToken) lastFocusToken = state.focusToken;

  renderBroadcastStage(refs.stage, state, {
    room,
    onTeamClick: openTeam,
    onOpenBoard: openBoard
  });
}

function syncControlsFromState(state) {
  syncingControls = true;
  refs.screen.value = state.screen || "lobby";
  refs.team.value = state.currentTeam || "";
  const selected = teamByName(state.currentTeam);
  refs.lastWins.value = state.lastSeasonWins ?? selected?.lastWins ?? "";
  refs.line.value = state.winLine ?? selected?.line ?? "";
  refs.bid.value = state.currentBid ?? "";
  refs.message.value = state.message || "";

  const players = Array.isArray(state.players) ? state.players : [];
  for (let i = 0; i < 6; i++) {
    const p = players[i] || {};
    const nameInput = refs.playerRows.querySelector(`[data-player-name="${i}"]`);
    const budgetInput = refs.playerRows.querySelector(`[data-player-budget="${i}"]`);
    if (nameInput) nameInput.value = p.name || `Player ${i + 1}`;
    if (budgetInput) budgetInput.value = Number.isFinite(Number(p.remaining)) ? p.remaining : 50;
  }
  syncingControls = false;
}

function readPlayers() {
  return Array.from({ length: 6 }, (_, i) => {
    const name = refs.playerRows.querySelector(`[data-player-name="${i}"]`)?.value.trim() || `Player ${i + 1}`;
    const raw = refs.playerRows.querySelector(`[data-player-budget="${i}"]`)?.value;
    const remaining = Number(raw);
    const existing = currentState?.players?.[i];
    return {
      name,
      remaining: Number.isFinite(remaining) ? remaining : 0,
      teams: Array.isArray(existing?.teams) ? existing.teams : []
    };
  });
}

function numberOrNull(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function sendPatch(patch) {
  refs.error.textContent = "";
  try {
    const result = await putState(room, controlKey, patch);
    render(result.state);
    return result.state;
  } catch (error) {
    if (String(error.message).includes("older PIN system")) {
      refs.error.textContent = "This old test room used the earlier PIN system. Click NEW ROOM in the next build or clear this site's storage to start fresh.";
    } else {
      refs.error.textContent = error.message;
    }
    throw error;
  }
}

async function publishFromControls() {
  refs.publishBtn.disabled = true;
  try {
    const state = await sendPatch({
      screen: refs.screen.value,
      currentTeam: refs.team.value || null,
      lastSeasonWins: numberOrNull(refs.lastWins.value),
      winLine: numberOrNull(refs.line.value),
      currentBid: numberOrNull(refs.bid.value),
      message: refs.message.value.trim(),
      players: readPlayers()
    });
    syncControlsFromState(state);
    return true;
  } catch (_) {
    return false;
  } finally {
    refs.publishBtn.disabled = false;
  }
}

async function returnEveryone() {
  refs.returnEveryoneBtn.disabled = true;
  try {
    await sendPatch({ focusToken: crypto.randomUUID() });
    closeLocal();
    closeDrawer();
  } catch (_) {
  } finally {
    refs.returnEveryoneBtn.disabled = false;
  }
}

async function demoSpin() {
  refs.spinDemoBtn.disabled = true;
  closeDrawer();
  try {
    const spinId = crypto.randomUUID();
    await sendPatch({
      screen: "wheel",
      currentTeam: null,
      wheel: { spinning: true, selectedTeam: null, spinId },
      focusToken: crypto.randomUUID()
    });

    setTimeout(async () => {
      const team = TEAMS[Math.floor(Math.random() * TEAMS.length)];
      try {
        const state = await sendPatch({
          screen: "team",
          currentTeam: team.name,
          lastSeasonWins: team.lastWins,
          winLine: team.line,
          wheel: { spinning: false, selectedTeam: team.name, spinId }
        });
        syncControlsFromState(state);
      } catch (_) {}
      refs.spinDemoBtn.disabled = false;
    }, 1800);
  } catch (_) {
    refs.spinDemoBtn.disabled = false;
  }
}

async function connect() {
  controlKey = controlKeyForRoom(room);
  localStorage.setItem("courtvision-control-room", room);
  localStorage.setItem("courtvision-room", room);

  const watchUrl = `${location.origin}/watch.html?room=${encodeURIComponent(room)}`;
  refs.watchUrl.value = watchUrl;

  stopSocket?.();
  refs.error.textContent = "";

  try {
    const info = await getRoomInfo(room);

    if (info.claimed && info.authType && info.authType !== "auto-key") {
      room = generateRoomName();
      localStorage.setItem("courtvision-control-room", room);
      controlKey = controlKeyForRoom(room);
      refs.watchUrl.value = `${location.origin}/watch.html?room=${encodeURIComponent(room)}`;
      return connect();
    }

    lastFocusToken = info.state.focusToken || null;
    render(info.state);
    syncControlsFromState(info.state);
  } catch (error) {
    refs.error.textContent = error.message;
  }

  stopSocket = connectRoom(room, {
    onStatus: setStatus,
    onState: state => {
      render(state);
      if (!refs.drawer.classList.contains("open")) syncControlsFromState(state);
    }
  });
}

refs.controlsBtn.addEventListener("click", openDrawer);
refs.closeControlsBtn.addEventListener("click", closeDrawer);
refs.scrim.addEventListener("click", closeDrawer);
refs.publishBtn.addEventListener("click", publishFromControls);
refs.returnEveryoneBtn.addEventListener("click", returnEveryone);
refs.spinDemoBtn.addEventListener("click", demoSpin);

refs.copyLinkBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(refs.watchUrl.value);
    const old = refs.copyLinkBtn.textContent;
    refs.copyLinkBtn.textContent = "COPIED";
    setTimeout(() => { refs.copyLinkBtn.textContent = old; }, 1200);
  } catch (_) {
    refs.watchUrl.select();
  }
});

refs.team.addEventListener("change", () => {
  if (syncingControls) return;
  const team = teamByName(refs.team.value);
  if (team) {
    refs.lastWins.value = team.lastWins;
    refs.line.value = team.line;
  }
});

connect();
