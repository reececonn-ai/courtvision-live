import { roomFromLocation, getState, putState, connectRoom } from "./shared.js";
import { TEAMS, teamByName, renderBroadcastStage } from "./stage.js";

const room = roomFromLocation();
const stage = document.getElementById("stage");
const statusEl = document.getElementById("connStatus");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const dock = document.getElementById("sharedDock");
const dockTeam = document.getElementById("dockTeam");
const bidderInput = document.getElementById("bidderInput");
const bidInput = document.getElementById("bidInput");
const assignBtn = document.getElementById("assignBtn");
const passBtn = document.getElementById("passBtn");
const backBtn = document.getElementById("backBtn");
const toast = document.getElementById("toast");

let state = null;
let spinTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2200);
}

function setStatus(value) {
  statusEl.textContent = value === "live" ? "LIVE" : value.toUpperCase();
  statusEl.classList.toggle("live", value === "live");
}

async function update(patch) {
  try {
    state = await putState(room, patch);
    render(state);
    return state;
  } catch (error) {
    showToast(error.message || "Update failed");
    throw error;
  }
}

function syncDock(current) {
  const show = current.screen === "team" || current.screen === "bidding";
  dock.hidden = !show;
  if (!show) return;

  const players = Array.isArray(current.players) ? current.players : [];
  const previous = bidderInput.value || "0";
  bidderInput.innerHTML = players.map((p, i) =>
    `<option value="${i}">${p.name || `Player ${i + 1}`} · $${Number(p.remaining ?? 0)}</option>`
  ).join("");
  bidderInput.value = players[Number(previous)] ? previous : "0";
  dockTeam.textContent = current.currentTeam || "TEAM ON THE BOARD";
  bidInput.value = current.currentBid ?? "";
}

function render(current) {
  state = current;
  renderBroadcastStage(stage, current, {
    room,
    canControl: true,
    onSpin: spinWheel,
    onTeamClick: openTeamForEveryone,
    onOpenBoard: backToWheel
  });
  syncDock(current);
}

async function openTeamForEveryone(name) {
  if (state?.wheel?.spinning) return;
  const team = teamByName(name);
  if (!team) return;

  await update({
    screen: "team",
    currentTeam: team.name,
    lastSeasonWins: team.lastWins,
    winLine: team.line,
    currentBid: null
  });
}

async function backToWheel() {
  if (state?.wheel?.spinning) return;
  await update({
    screen: "wheel",
    currentTeam: null,
    currentBid: null
  });
}

async function spinWheel() {
  if (state?.wheel?.spinning) return;
  const available = Array.isArray(state?.available) ? state.available : [];
  if (!available.length) {
    await update({ screen: "barrel" });
    return;
  }

  const targetName = available[Math.floor(Math.random() * available.length)];
  const target = teamByName(targetName);
  const spinId = crypto.randomUUID();
  const duration = 5000;
  const startedAt = Date.now();

  await update({
    screen: "wheel",
    currentTeam: null,
    currentBid: null,
    wheel: {
      spinning: true,
      targetTeam: targetName,
      selectedTeam: null,
      spinId,
      startedAt,
      duration
    }
  });

  clearTimeout(spinTimer);
  spinTimer = setTimeout(async () => {
    try {
      await update({
        screen: "team",
        currentTeam: targetName,
        lastSeasonWins: target?.lastWins ?? null,
        winLine: target?.line ?? null,
        currentBid: null,
        wheel: {
          spinning: false,
          targetTeam: targetName,
          selectedTeam: targetName,
          spinId,
          startedAt,
          duration
        }
      });
    } catch (_) {}
  }, duration + 350);
}

async function assignTeam() {
  const teamName = state?.currentTeam;
  if (!teamName) return;

  const players = (state.players || []).map(p => ({ ...p, teams: [...(p.teams || [])] }));
  const idx = Math.max(0, Math.min(players.length - 1, Number(bidderInput.value || 0)));
  const player = players[idx];
  const price = Math.max(0, Number(bidInput.value || 0));

  if (!player) return;
  if ((player.teams || []).length >= Number(state.teamCap || 5)) {
    showToast(`${player.name} already has 5 teams`);
    return;
  }
  if (price > Number(player.remaining || 0)) {
    showToast(`${player.name} only has $${player.remaining} remaining`);
    return;
  }

  player.remaining = Number(player.remaining || 0) - price;
  if (!player.teams.includes(teamName)) player.teams.push(teamName);

  const assignments = {
    ...(state.assignments || {}),
    [teamName]: { player: player.name, playerIndex: idx, price }
  };
  const available = (state.available || []).filter(name => name !== teamName);
  const history = [
    ...(state.history || []),
    { type: "assign", team: teamName, player: player.name, price, at: Date.now() }
  ];

  await update({
    players,
    assignments,
    available,
    history,
    currentTeam: null,
    currentBid: null,
    screen: available.length ? "wheel" : "barrel",
    wheel: { spinning: false, targetTeam: null, selectedTeam: null, spinId: null }
  });
}

async function passTeam() {
  const teamName = state?.currentTeam;
  if (!teamName) return;

  const available = (state.available || []).filter(name => name !== teamName);
  const passed = Array.from(new Set([...(state.passed || []), teamName]));
  const history = [...(state.history || []), { type: "pass", team: teamName, at: Date.now() }];

  await update({
    available,
    passed,
    history,
    currentTeam: null,
    currentBid: null,
    screen: available.length ? "wheel" : "barrel",
    wheel: { spinning: false, targetTeam: null, selectedTeam: null, spinId: null }
  });
}

assignBtn.addEventListener("click", assignTeam);
passBtn.addEventListener("click", passTeam);
backBtn.addEventListener("click", backToWheel);

bidInput.addEventListener("input", () => {
  if (!state || (state.screen !== "team" && state.screen !== "bidding")) return;
  state = { ...state, screen: "bidding", currentBid: bidInput.value === "" ? null : Number(bidInput.value) };
  render(state);
});

bidInput.addEventListener("change", async () => {
  await update({
    screen: "bidding",
    currentBid: bidInput.value === "" ? null : Math.max(0, Number(bidInput.value || 0))
  });
});

copyLinkBtn.addEventListener("click", async () => {
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    copyLinkBtn.textContent = "COPIED";
    setTimeout(() => { copyLinkBtn.textContent = "COPY LINK"; }, 1300);
  } catch (_) {
    showToast("Copy this page URL from your browser");
  }
});

try {
  state = await getState(room);
  render(state);
} catch (error) {
  showToast(error.message || "Could not load draft");
}

connectRoom(room, {
  onStatus: setStatus,
  onState: render
});
